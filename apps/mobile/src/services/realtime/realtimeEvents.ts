import {
  REALTIME_EVENT_TYPES,
  type JobChange,
  type RealtimeEnvelope,
  type RealtimeEventType,
} from '@fieldops/types';

/**
 * Checks on what the realtime channel delivers. The server is trusted as a source, but the
 * payload still crosses a network boundary, so it is validated before the app acts on it
 * (docs/architecture.md, "Validation"). Pure, and unit-tested.
 */

const JOB_CHANGES: readonly JobChange[] = [
  'assigned',
  'unassigned',
  'updated',
  'started',
  'completed',
  'cancelled',
  'note',
  'evidence',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function parseRealtimeEnvelope(value: unknown): RealtimeEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, type, version, occurredAt, data } = value;
  if (
    typeof id !== 'string' ||
    typeof occurredAt !== 'string' ||
    version !== 1 ||
    !REALTIME_EVENT_TYPES.includes(type as RealtimeEventType) ||
    !isRecord(data)
  ) {
    return null;
  }
  const { jobId, change, status, version: jobVersion, messageId } = data;
  if (typeof jobId !== 'string') {
    return null;
  }
  if (type === 'job.changed') {
    if (!JOB_CHANGES.includes(change as JobChange)) {
      return null;
    }
    return {
      id,
      type,
      version,
      occurredAt,
      data: {
        jobId,
        change: change as JobChange,
        ...(typeof status === 'string' && { status }),
        ...(typeof jobVersion === 'number' && { version: jobVersion }),
      },
    };
  }
  if (typeof messageId !== 'string') {
    return null;
  }
  return {
    id,
    type: 'job.message.created',
    version,
    occurredAt,
    data: { jobId, messageId },
  };
}

/** Why the server refused a connection, from socket.io's `connect_error`. */
export type ConnectRefusal =
  /** Refresh the session, then try again. */
  | 'token_expired'
  /** The session is over: stop until the user signs in again. */
  | 'unauthorized'
  /** Not a refusal: the server could not be reached. */
  | 'unreachable';

export function classifyConnectError(error: unknown): ConnectRefusal {
  const reported = isRecord(error) ? error : {};
  const { message: reportedMessage } = reported;
  const message =
    error instanceof Error
      ? error.message
      : typeof reportedMessage === 'string'
      ? reportedMessage
      : '';
  switch (message) {
    case 'ACCESS_TOKEN_EXPIRED':
      return 'token_expired';
    case 'UNAUTHENTICATED':
    case 'ACCESS_TOKEN_INVALID':
    case 'SESSION_REVOKED':
    case 'SESSION_EXPIRED':
    case 'ACCOUNT_DISABLED':
      return 'unauthorized';
    default:
      return 'unreachable';
  }
}

/** Remembers recently seen event IDs, so a duplicated delivery is handled once. */
export class RecentIds {
  private readonly ids: string[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly capacity = 200) {}

  /** True the first time an ID is offered. */
  add(id: string): boolean {
    if (this.seen.has(id)) {
      return false;
    }
    this.seen.add(id);
    this.ids.push(id);
    if (this.ids.length > this.capacity) {
      const oldest = this.ids.shift();
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    return true;
  }
}
