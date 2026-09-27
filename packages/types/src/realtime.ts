/**
 * The realtime (WebSocket) contract between the API gateway and the app. See
 * docs/realtime.md.
 *
 * Events are HINTS, never data: they carry IDs and a status so the client knows what to
 * refresh, and the client then reads the authoritative state through its normal path (the
 * worker's sync engine, a manager's REST refetch). A missed event is therefore harmless: the
 * next sync converges anyway.
 */

/** Socket.IO path on the API origin (not under /api/v1). */
export const REALTIME_PATH = '/realtime';

/** What happened to a job. */
export type JobChange =
  | 'assigned'
  /** Sent only to a worker a job was taken away from (reassigned): it leaves their device. */
  | 'unassigned'
  | 'updated'
  | 'accepted'
  | 'declined'
  | 'departed'
  | 'arrived'
  | 'started'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rescheduled'
  | 'note'
  | 'evidence';

export interface JobChangedData {
  readonly jobId: string;
  readonly change: JobChange;
  /** Omitted for `unassigned`: the recipient may no longer see the job. */
  readonly status?: string;
  readonly version?: number;
}

export interface JobMessageCreatedData {
  readonly jobId: string;
  readonly messageId: string;
}

export interface RealtimeEventMap {
  readonly 'job.changed': JobChangedData;
  readonly 'job.message.created': JobMessageCreatedData;
}

export type RealtimeEventType = keyof RealtimeEventMap;

export const REALTIME_EVENT_TYPES: readonly RealtimeEventType[] = [
  'job.changed',
  'job.message.created',
];

/** Every event travels in this envelope, emitted under the Socket.IO event name `event`. */
export interface RealtimeEnvelope<
  Type extends RealtimeEventType = RealtimeEventType,
> {
  /** Unique per event (UUIDv7): lets a client ignore a duplicate delivery. */
  readonly id: string;
  readonly type: Type;
  /** Payload schema version for `type`. */
  readonly version: 1;
  /** ISO 8601 server time. */
  readonly occurredAt: string;
  readonly data: RealtimeEventMap[Type];
}

/** The Socket.IO event name carrying every envelope. */
export const REALTIME_EVENT = 'event';

/**
 * Why the server refused or closed a connection (the `message` of the client's
 * `connect_error`). ACCESS_TOKEN_EXPIRED means: refresh the session, then reconnect.
 */
export type RealtimeRefusal =
  | 'UNAUTHENTICATED'
  | 'ACCESS_TOKEN_EXPIRED'
  | 'ACCESS_TOKEN_INVALID'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_DISABLED'
  | 'ORGANIZATION_SUSPENDED';
