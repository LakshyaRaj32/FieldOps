import { nextStatus, type JobTransition } from '@fieldops/shared';
import { distanceMeters } from '@fieldops/shared/geo';
import {
  JobAction,
  JobStatus,
  type ActionLocation,
  type DeviceLocation,
  type JobDetail,
  type JobEvidence,
  type JobLine,
  type JobMessage,
  type JobNote,
  type JobType,
  type PaymentRecord,
  type UserSummary,
} from '@fieldops/types';

import { STATUS_COMMANDS, type OutboxEntry, type SubmitPayload } from './types';

/**
 * The local view of a job: the last server copy with the worker's pending commands applied
 * in order (a local "rebase"). Pure and deterministic.
 *
 * Because the outbox stores commands rather than overwritten rows, a fresh server copy never
 * erases unsynced work: the commands are simply re-applied on top of it. A command the new
 * server state no longer allows (the job was cancelled meanwhile) is not applied: the
 * server state is shown, and the server's verdict on the command arrives with the next push.
 */
export function projectJob(
  server: JobDetail,
  pending: readonly OutboxEntry[],
  me: UserSummary,
): JobDetail {
  let job: JobDetail = server;
  const notes: JobNote[] = [...server.fieldNotes];
  const evidence: JobEvidence[] = [...server.evidence];
  const messages: JobMessage[] = [...server.messages];

  for (const entry of pending) {
    const action = STATUS_COMMANDS[entry.type];
    if (action !== undefined) {
      const to = nextStatus(job.type, job.status, action as JobTransition);
      if (to !== undefined) {
        job = applyStatus(job, entry, to, me);
      }
      continue;
    }
    switch (entry.type) {
      case 'job.note.add': {
        const { noteId, body } = entry.payload;
        if (!notes.some(note => note.id === noteId)) {
          notes.push({
            id: noteId,
            body,
            author: me,
            occurredAt: entry.occurredAt,
            // Not received yet: shown at the device time until the server confirms.
            createdAt: entry.occurredAt,
          });
        }
        break;
      }
      case 'job.evidence.add': {
        const photo = entry.payload;
        if (!evidence.some(item => item.id === photo.evidenceId)) {
          evidence.push({
            id: photo.evidenceId,
            contentType: photo.contentType,
            sizeBytes: photo.sizeBytes,
            width: photo.width,
            height: photo.height,
            uploadedBy: me,
            capturedAt: entry.occurredAt,
            createdAt: entry.occurredAt,
          });
        }
        break;
      }
      case 'job.message.send': {
        const { messageId, body } = entry.payload;
        if (!messages.some(message => message.id === messageId)) {
          messages.push({
            id: messageId,
            body,
            author: me,
            occurredAt: entry.occurredAt,
            createdAt: entry.occurredAt,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    ...job,
    fieldNotes: notes,
    evidence,
    messages,
    allowedActions: workerActions(job.type, job.status),
  };
}

/** A status command applied locally, with the fields the server would set. */
function applyStatus(
  job: JobDetail,
  entry: OutboxEntry,
  to: JobDetail['status'],
  me: UserSummary,
): JobDetail {
  const at = entry.occurredAt;
  const moved: JobDetail = { ...job, status: to };
  switch (entry.type) {
    case 'job.accept':
      return { ...moved, acceptedAt: at };
    case 'job.decline':
      // Handed back: it is nobody's until the manager assigns it again.
      return { ...moved, assignedWorker: null, acceptedAt: null };
    case 'job.depart':
      return moved;
    case 'job.arrive':
      return {
        ...moved,
        arrivedAt: at,
        arrivalLocation: estimate(job, entry.payload?.location ?? null),
      };
    case 'job.start':
      return {
        ...moved,
        startedAt: at,
        startLocation: estimate(job, entry.payload?.location ?? null),
      };
    case 'job.complete':
      return {
        ...moved,
        completedAt: at,
        completeLocation: estimate(job, entry.payload?.location ?? null),
      };
    case 'job.fail':
      return { ...moved, failedAt: at, failureReason: entry.payload.reason };
    case 'job.submit':
      return applySubmission(moved, entry.payload, at, me);
    default:
      return moved;
  }
}

/** The worker's answers, counts, order lines and payment, as the server will record them. */
function applySubmission(
  job: JobDetail,
  payload: SubmitPayload,
  at: string,
  me: UserSummary,
): JobDetail {
  const { request } = payload;
  const answers = new Map(
    (request.checklist ?? []).map(answer => [answer.itemId, answer]),
  );
  const counts = new Map(
    (request.lineCounts ?? []).map(count => [count.lineId, count.quantity]),
  );
  let lines: JobLine[] = job.lines.map(line => ({
    ...line,
    quantity: counts.get(line.id) ?? line.quantity,
  }));
  if (request.orderLines !== undefined) {
    lines = request.orderLines.map((line, position) => ({
      id: `local-${position}`,
      position,
      productId: line.productId,
      productName: payload.productNames[line.productId]?.name ?? 'Product',
      sku: payload.productNames[line.productId]?.sku ?? '',
      expectedQuantity: null,
      quantity: line.quantity,
    }));
  }
  const payments: PaymentRecord[] =
    request.payment === undefined ||
    job.payments.some(payment => payment.id === request.payment?.id)
      ? [...job.payments]
      : [
          ...job.payments,
          {
            id: request.payment.id,
            orderId: job.order?.id ?? '',
            jobId: job.id,
            amount: request.payment.amount,
            method: request.payment.method,
            reference: request.payment.reference ?? null,
            status: 'PENDING_VERIFICATION',
            collectedAt: request.payment.collectedAt,
            recordedBy: me,
            verifiedBy: null,
            verifiedAt: null,
            rejectionReason: null,
            createdAt: at,
          },
        ];
  return {
    ...job,
    submittedAt: at,
    submissionNote: request.note ?? null,
    completeLocation: estimate(job, payload.location),
    checklist: job.checklist.map(item => {
      const answer = answers.get(item.id);
      return answer === undefined
        ? item
        : {
            ...item,
            checked: answer.checked,
            responseNote: answer.note ?? null,
          };
    }),
    lines,
    payments,
  };
}

/**
 * A pending command's location, with the phone's own distance estimate (the same formula
 * the server uses; the server's value replaces it after sync).
 */
function estimate(
  job: JobDetail,
  location: DeviceLocation | null,
): ActionLocation | null {
  if (location === null) {
    return null;
  }
  return {
    ...location,
    distanceMeters:
      job.location === null
        ? null
        : Math.round(distanceMeters(job.location, location)),
  };
}

/** The worker's status steps in the order the server lists them (job.policy.ts). */
const WORKER_STEPS: readonly [JobAction, JobTransition][] = [
  [JobAction.ACCEPT, 'accept'],
  [JobAction.DEPART, 'depart'],
  [JobAction.ARRIVE, 'arrive'],
  [JobAction.START, 'start'],
  [JobAction.COMPLETE, 'complete'],
  [JobAction.SUBMIT, 'submit'],
];

/**
 * What the assigned worker can do with a job, decided on the device with the same state
 * machine the server enforces. Every job on the device is assigned to its user (the working
 * set contains nothing else), so only the type and status matter, except that a job the
 * worker handed back (PENDING) offers nothing at all.
 */
export function workerActions(type: JobType, status: JobStatus): JobAction[] {
  if (status === JobStatus.PENDING) {
    return [];
  }
  const allows = (transition: JobTransition) =>
    nextStatus(type, status, transition) !== undefined;
  return [
    ...WORKER_STEPS.filter(([, transition]) => allows(transition)).map(
      ([action]) => action,
    ),
    JobAction.NOTE,
    JobAction.EVIDENCE,
    JobAction.MESSAGE,
    ...(allows('decline') ? [JobAction.DECLINE] : []),
    ...(allows('fail') ? [JobAction.FAIL] : []),
  ];
}
