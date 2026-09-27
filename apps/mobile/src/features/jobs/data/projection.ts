import { nextStatus } from '@fieldops/shared';
import { distanceMeters } from '@fieldops/shared/geo';
import {
  JobAction,
  type ActionLocation,
  type DeviceLocation,
  type JobDetail,
  type JobEvidence,
  type JobMessage,
  type JobNote,
  type JobStatus,
  type UserSummary,
} from '@fieldops/types';

import type { OutboxEntry } from './types';

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
  let status: JobStatus = server.status;
  let startedAt = server.startedAt;
  let completedAt = server.completedAt;
  let startLocation = server.startLocation;
  let completeLocation = server.completeLocation;
  const notes: JobNote[] = [...server.fieldNotes];
  const evidence: JobEvidence[] = [...server.evidence];
  const messages: JobMessage[] = [...server.messages];

  for (const entry of pending) {
    switch (entry.type) {
      case 'job.start': {
        const to = nextStatus(status, 'start');
        if (to !== undefined) {
          status = to;
          startedAt = entry.occurredAt;
          startLocation = estimate(server, entry.payload?.location ?? null);
        }
        break;
      }
      case 'job.complete': {
        const to = nextStatus(status, 'complete');
        if (to !== undefined) {
          status = to;
          completedAt = entry.occurredAt;
          completeLocation = estimate(server, entry.payload?.location ?? null);
        }
        break;
      }
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
    }
  }

  return {
    ...server,
    status,
    startedAt,
    completedAt,
    startLocation,
    completeLocation,
    fieldNotes: notes,
    evidence,
    messages,
    allowedActions: workerActions(status),
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

/**
 * What the assigned worker can do with a job in `status`, decided on the device with the
 * same state machine the server enforces. Every job on the device is assigned to its user
 * (the working set contains nothing else), so only the status matters here.
 */
export function workerActions(status: JobStatus): JobAction[] {
  return [
    ...(nextStatus(status, 'start') !== undefined ? [JobAction.START] : []),
    ...(nextStatus(status, 'complete') !== undefined
      ? [JobAction.COMPLETE]
      : []),
    JobAction.NOTE,
    JobAction.EVIDENCE,
    JobAction.MESSAGE,
  ];
}
