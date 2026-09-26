import type { JobDetail } from '@fieldops/types';

/** The worker commands that work offline. Names follow the `entity.action` convention. */
export type OutboxType = 'job.start' | 'job.complete' | 'job.note.add';

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

export interface NotePayload {
  readonly noteId: string;
  readonly body: string;
}

export interface OutboxError {
  readonly code: string;
  readonly message: string;
}

export interface OutboxEntry {
  readonly seq: number;
  readonly mutationId: string;
  readonly type: OutboxType;
  readonly jobId: string;
  /** Kept for display: the job may leave the device before the entry is resolved. */
  readonly jobTitle: string;
  readonly payload: NotePayload | null;
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

/** Why a local command was refused before anything was written. */
export class LocalCommandError extends Error {
  override readonly name = 'LocalCommandError';

  constructor(
    readonly code: 'JOB_NOT_FOUND' | 'INVALID_STATUS_TRANSITION',
    message: string,
  ) {
    super(message);
  }
}
