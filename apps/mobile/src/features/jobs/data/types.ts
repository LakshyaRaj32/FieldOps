import type {
  DeviceLocation,
  EvidenceContentType,
  JobDetail,
  SubmitJobRequest,
} from '@fieldops/types';

/** The worker's status commands, named like their endpoints (POST /jobs/:id/<action>). */
export type WorkerStatusAction =
  | 'accept'
  | 'decline'
  | 'depart'
  | 'arrive'
  | 'start'
  | 'complete'
  | 'submit'
  | 'fail';

/** The worker commands that work offline. Names follow the `entity.action` convention. */
export type OutboxType =
  | 'job.accept'
  | 'job.decline'
  | 'job.depart'
  | 'job.arrive'
  | 'job.start'
  | 'job.complete'
  | 'job.submit'
  | 'job.fail'
  | 'job.note.add'
  | 'job.evidence.add'
  | 'job.message.send';

/** Outbox types that are status commands, with the action each one sends. */
export const STATUS_COMMANDS: Readonly<
  Partial<Record<OutboxType, WorkerStatusAction>>
> = {
  'job.accept': 'accept',
  'job.decline': 'decline',
  'job.depart': 'depart',
  'job.arrive': 'arrive',
  'job.start': 'start',
  'job.complete': 'complete',
  'job.submit': 'submit',
  'job.fail': 'fail',
};

/**
 * - `pending`: waiting to be sent (possibly until `nextAttemptAt`)
 * - `in_flight`: being sent right now (reset to pending on start-up: the attempt may or may
 *   not have reached the server, and the server deduplicates)
 * - `synced`: the server applied it (kept briefly for diagnostics, then pruned)
 * - `failed`: rejected as invalid, or out of retries; never retried automatically
 * - `conflict`: the server state no longer allows it (for example the job was cancelled);
 *   the server state wins and the worker is told
 */
export type OutboxStatus =
  | 'pending'
  | 'in_flight'
  | 'synced'
  | 'failed'
  | 'conflict';

/** Status commands: where the worker was, if the phone had a fix (Phase 4). */
export interface StatusPayload {
  readonly location: DeviceLocation | null;
}

/** Decline and fail: why, as the worker wrote it (and where, for a failure). */
export interface ReasonPayload extends StatusPayload {
  readonly reason: string;
}

/**
 * The worker's result, exactly as it will be sent (minus the location, kept apart like every
 * status command). `productNames` lets the phone show an order collection's lines offline.
 */
export interface SubmitPayload extends StatusPayload {
  readonly request: Omit<SubmitJobRequest, 'location'>;
  readonly productNames: Readonly<
    Record<string, { readonly name: string; readonly sku: string }>
  >;
}

export interface NotePayload {
  readonly noteId: string;
  readonly body: string;
}

/** A photo waiting to upload. The bytes stay in app-private storage at `fileUri`. */
export interface EvidencePayload {
  readonly evidenceId: string;
  readonly fileUri: string;
  readonly contentType: EvidenceContentType;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface MessagePayload {
  readonly messageId: string;
  readonly body: string;
}

/** Each command type with the payload it carries. */
export type OutboxCommand =
  | {
      readonly type:
        | 'job.accept'
        | 'job.depart'
        | 'job.arrive'
        | 'job.start'
        | 'job.complete';
      /** Null for entries written before Phase 4. */
      readonly payload: StatusPayload | null;
    }
  | {
      readonly type: 'job.decline' | 'job.fail';
      readonly payload: ReasonPayload;
    }
  | { readonly type: 'job.submit'; readonly payload: SubmitPayload }
  | { readonly type: 'job.note.add'; readonly payload: NotePayload }
  | { readonly type: 'job.evidence.add'; readonly payload: EvidencePayload }
  | { readonly type: 'job.message.send'; readonly payload: MessagePayload };

export interface OutboxError {
  readonly code: string;
  readonly message: string;
}

interface OutboxEntryBase {
  readonly seq: number;
  readonly mutationId: string;
  readonly jobId: string;
  /** Kept for display: the job may leave the device before the entry is resolved. */
  readonly jobTitle: string;
  /** The server version the worker was looking at (diagnostics). */
  readonly baseVersion: number;
  /** Device time of the action. */
  readonly occurredAt: string;
  readonly status: OutboxStatus;
  /** Attempts the server answered with a retryable failure (network failures don't count). */
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastError: OutboxError | null;
  readonly createdAt: string;
}

export type OutboxEntry = OutboxEntryBase & OutboxCommand;

/** A job as the worker's screens see it. */
export interface LocalJob {
  /** Server copy with the pending commands applied. */
  readonly job: JobDetail;
  /** Commands not yet confirmed by the server. */
  readonly pendingChanges: number;
  /** Commands the server rejected (conflict or failure) that the worker has not dismissed. */
  readonly problems: number;
}

export interface OutboxCounts {
  readonly pending: number;
  readonly failed: number;
  readonly conflicts: number;
}

/** Where a photo is in its journey to the server, for the evidence gallery. */
export type EvidenceUploadState =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export interface LocalEvidenceFile {
  readonly evidenceId: string;
  /** The on-device copy (preview without network, and the upload source). */
  readonly fileUri: string;
  readonly state: EvidenceUploadState;
}

/** Why a local command was refused before anything was written. */
export class LocalCommandError extends Error {
  override readonly name = 'LocalCommandError';

  constructor(
    readonly code:
      | 'JOB_NOT_FOUND'
      | 'INVALID_STATUS_TRANSITION'
      | 'REQUIREMENTS_NOT_MET',
    message: string,
  ) {
    super(message);
  }
}
