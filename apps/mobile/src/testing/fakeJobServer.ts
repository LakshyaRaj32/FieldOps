import { decideTransition, type JobTransition } from '@fieldops/shared';
import type {
  AddJobNoteRequest,
  JobCommandRequest,
  JobDetail,
  JobWorkingSet,
  SendJobMessageRequest,
  UserSummary,
} from '@fieldops/types';

import type {
  EvidenceUpload,
  JobSyncTransport,
  TransportResult,
} from '../features/jobs/data/syncEngine';
import type { WorkerStatusAction } from '../features/jobs/data/types';
import type { AppError } from '../utils/errors';

export const WORKER: UserSummary = {
  id: 'worker-1',
  firstName: 'Asha',
  lastName: 'Verma',
};
const MANAGER: UserSummary = {
  id: 'manager-1',
  firstName: 'Ravi',
  lastName: 'Kumar',
};

export function serverJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1',
    type: 'GENERAL',
    title: 'AC repair',
    customerName: 'ABC Ltd',
    address: '12 MG Road',
    scheduledAt: '2026-09-28T05:00:00.000Z',
    priority: 'NORMAL',
    status: 'ASSIGNED',
    assignedWorker: WORKER,
    manager: MANAGER,
    shop: null,
    expectedAmount: null,
    version: 2,
    updatedAt: '2026-09-26T10:00:00.000Z',
    allowedActions: ['start', 'note'],
    description: null,
    location: null,
    notes: null,
    checklist: [],
    cancellationReason: null,
    createdBy: MANAGER,
    createdAt: '2026-09-26T09:00:00.000Z',
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    failureReason: null,
    order: null,
    lines: [],
    payments: [],
    requiresPhoto: false,
    submissionNote: null,
    siteRadiusMeters: 300,
    history: [],
    fieldNotes: [],
    arrivalLocation: null,
    startLocation: null,
    completeLocation: null,
    evidence: [],
    messages: [],
    ...overrides,
  };
}

export const networkError: AppError = {
  kind: 'network',
  message: "Can't reach the FieldOps server.",
};

export function httpError(status: number, code: string): AppError {
  return { kind: 'http', status, code, message: `${code} (${status})` };
}

/** What the next request experiences. */
export type Fault =
  | { readonly type: 'http'; readonly status: number; readonly code: string }
  /** The server applies the command, but the response never arrives. */
  | { readonly type: 'lostResponse' };

interface Call {
  readonly operation: string;
  readonly jobId: string;
  readonly mutationId: string;
  /** Start/complete bodies, uploads and messages, as sent. */
  readonly body?: unknown;
}

/**
 * A server with the real API's rules for worker commands: the shared state machine, the
 * assignment check (404 for a job that is not the worker's) and per-user idempotency keys.
 * Tests control connectivity, inject faults and act as the manager.
 */
export class FakeJobServer implements JobSyncTransport {
  readonly jobs = new Map<string, JobDetail>();
  readonly calls: Call[] = [];
  /** Commands actually applied (a replay does not count). */
  effects = 0;
  online = true;
  faults: Fault[] = [];
  /** Answers every command (not downloads) with this error until cleared. */
  commandFailure: { status: number; code: string } | null = null;
  private readonly processed = new Map<
    string,
    { operation: string; jobId: string }
  >();
  private clock = Date.parse('2026-09-27T08:00:00.000Z');

  constructor(jobs: readonly JobDetail[] = []) {
    for (const job of jobs) {
      this.jobs.set(job.id, job);
    }
  }

  // ---- Manager actions ---------------------------------------------------------------

  cancel(jobId: string): void {
    this.change(jobId, job => ({
      ...job,
      status: 'CANCELLED',
      cancelledAt: this.tick(),
    }));
  }

  reassign(jobId: string, worker: UserSummary): void {
    this.change(jobId, job => ({ ...job, assignedWorker: worker }));
  }

  editTitle(jobId: string, title: string): void {
    this.change(jobId, job => ({ ...job, title }));
  }

  // ---- Transport -----------------------------------------------------------------------

  workerCommand(
    action: WorkerStatusAction,
    jobId: string,
    mutationId: string,
    body: object,
  ) {
    return this.transition(action, jobId, mutationId, body);
  }

  async uploadEvidence(
    jobId: string,
    mutationId: string,
    upload: EvidenceUpload,
  ): Promise<TransportResult<JobDetail>> {
    return this.command(
      'job.evidence.add',
      jobId,
      mutationId,
      job => {
        if (job.evidence.some(existing => existing.id === upload.id)) {
          return job;
        }
        this.effects += 1;
        return {
          ...job,
          evidence: [
            ...job.evidence,
            {
              id: upload.id,
              contentType: upload.contentType,
              sizeBytes: 1000,
              width: 640,
              height: 480,
              uploadedBy: WORKER,
              capturedAt: upload.capturedAt,
              createdAt: this.tick(),
            },
          ],
        };
      },
      upload,
    );
  }

  async sendMessage(
    jobId: string,
    mutationId: string,
    message: SendJobMessageRequest,
  ): Promise<TransportResult<JobDetail>> {
    return this.command(
      'job.message.send',
      jobId,
      mutationId,
      job => {
        if (job.messages.some(existing => existing.id === message.id)) {
          return job;
        }
        this.effects += 1;
        return {
          ...job,
          messages: [
            ...job.messages,
            {
              id: message.id,
              body: message.body,
              author: WORKER,
              occurredAt: message.occurredAt,
              createdAt: this.tick(),
            },
          ],
        };
      },
      message,
    );
  }

  async addNote(
    jobId: string,
    mutationId: string,
    note: AddJobNoteRequest,
  ): Promise<TransportResult<JobDetail>> {
    return this.command('job.note.add', jobId, mutationId, job => {
      if (job.fieldNotes.some(existing => existing.id === note.id)) {
        return job;
      }
      this.effects += 1;
      return {
        ...job,
        fieldNotes: [
          ...job.fieldNotes,
          {
            id: note.id,
            body: note.body,
            author: WORKER,
            occurredAt: note.occurredAt,
            createdAt: this.tick(),
          },
        ],
      };
    });
  }

  async fetchWorkingSet(): Promise<TransportResult<JobWorkingSet>> {
    this.calls.push({ operation: 'pull', jobId: '', mutationId: '' });
    if (!this.online) {
      return { error: networkError };
    }
    const fault = this.faults.shift();
    if (fault?.type === 'http') {
      return { error: httpError(fault.status, fault.code) };
    }
    return {
      data: {
        jobs: [...this.jobs.values()]
          .filter(job => job.assignedWorker?.id === WORKER.id)
          .map(job => ({ ...job, allowedActions: [] })),
        products: [],
        generatedAt: this.tick(),
      },
    };
  }

  // ---- Internals -----------------------------------------------------------------------

  private transition(
    transition: JobTransition,
    jobId: string,
    mutationId: string,
    request: JobCommandRequest = {},
  ): Promise<TransportResult<JobDetail>> {
    const recorded =
      request.location === undefined
        ? null
        : { ...request.location, distanceMeters: null };
    const apply = (job: JobDetail): JobDetail => {
      const decision = decideTransition(job.type, job.status, transition);
      if (decision.kind === 'rejected') {
        throw httpError(409, 'INVALID_STATUS_TRANSITION');
      }
      if (decision.kind === 'alreadyApplied') {
        return job;
      }
      this.effects += 1;
      return {
        ...job,
        status: decision.to,
        version: job.version + 1,
        ...(transition === 'start' && {
          startedAt: this.tick(),
          startLocation: recorded,
        }),
        ...(transition === 'complete' && {
          completedAt: this.tick(),
          completeLocation: recorded,
        }),
        ...(transition === 'accept' && { acceptedAt: this.tick() }),
        ...(transition === 'arrive' && {
          arrivedAt: this.tick(),
          arrivalLocation: recorded,
        }),
        ...(transition === 'submit' && {
          submittedAt: this.tick(),
          completeLocation: recorded,
        }),
        ...(transition === 'decline' && { assignedWorker: null }),
      };
    };
    return this.command(`job.${transition}`, jobId, mutationId, apply, request);
  }

  private async command(
    operation: string,
    jobId: string,
    mutationId: string,
    apply: (job: JobDetail) => JobDetail,
    body?: unknown,
  ): Promise<TransportResult<JobDetail>> {
    this.calls.push({
      operation,
      jobId,
      mutationId,
      ...(body !== undefined && { body }),
    });
    if (!this.online) {
      return { error: networkError };
    }
    if (this.commandFailure !== null) {
      return {
        error: httpError(this.commandFailure.status, this.commandFailure.code),
      };
    }
    const fault = this.faults.shift();
    if (fault?.type === 'http') {
      return { error: httpError(fault.status, fault.code) };
    }
    const job = this.jobs.get(jobId);
    if (job === undefined || job.assignedWorker?.id !== WORKER.id) {
      return { error: httpError(404, 'NOT_FOUND') };
    }
    const earlier = this.processed.get(mutationId);
    let result: JobDetail;
    if (earlier !== undefined) {
      if (earlier.operation !== operation || earlier.jobId !== jobId) {
        return { error: httpError(422, 'IDEMPOTENCY_KEY_REUSED') };
      }
      result = job; // replay: the current job, nothing applied
    } else {
      try {
        result = apply(job);
      } catch (error) {
        return { error: error as AppError };
      }
      this.jobs.set(jobId, result);
      this.processed.set(mutationId, { operation, jobId });
    }
    if (fault?.type === 'lostResponse') {
      return { error: networkError };
    }
    return { data: result };
  }

  private change(jobId: string, update: (job: JobDetail) => JobDetail): void {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new Error(`No job ${jobId}`);
    }
    const next = update(job);
    this.jobs.set(jobId, { ...next, version: job.version + 1 });
  }

  private tick(): string {
    this.clock += 1_000;
    return new Date(this.clock).toISOString();
  }
}
