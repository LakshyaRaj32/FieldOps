import type { AppError } from '../../../utils/errors';

/**
 * How the sync engine treats a failed request. See docs/synchronization.md, "Retry and
 * backoff".
 */
export const RETRY_POLICY = {
  /** First retry after at most this long. */
  baseDelayMs: 2_000,
  /** Backoff never exceeds this. */
  maxDelayMs: 10 * 60_000,
  /**
   * Counted attempts before an entry is moved to `failed` (dead letter). Only failures the
   * server answered count: being offline is not the command's fault.
   */
  maxAttempts: 10,
} as const;

export type RetryPolicy = typeof RETRY_POLICY;

export type FailureKind =
  /** No usable connection (network error, timeout): retry later, do not count. */
  | 'offline'
  /** The server is having trouble (5xx, 429, a concurrent update): back off, count. */
  | 'retryable'
  /** The server state no longer allows the command: the server wins, never retry. */
  | 'conflict'
  /** The request is invalid (validation, a reused key): a bug, never retry. */
  | 'rejected'
  /** The session could not be refreshed: pause until the user signs in again. */
  | 'unauthenticated';

/** Codes that mean "the job moved on without this device". */
const CONFLICT_CODES: readonly string[] = [
  'INVALID_STATUS_TRANSITION',
  'NOT_FOUND',
  'FORBIDDEN',
];

/**
 * Set by the transport when a photo's file is no longer on the phone: no retry can help, so
 * the upload fails for good and the worker is told (instead of retrying forever as if
 * offline).
 */
export const LOCAL_FILE_MISSING = 'LOCAL_FILE_MISSING';

export function classifyFailure(error: AppError): FailureKind {
  if (error.code === LOCAL_FILE_MISSING) {
    return 'rejected';
  }
  switch (error.kind) {
    case 'network':
    case 'timeout':
    case 'config':
      return 'offline';
    case 'parse':
    case 'unexpected':
      return 'retryable';
    case 'http':
      break;
  }
  const status = error.status ?? 0;
  if (status === 401) {
    // The base query already tried to refresh the session once.
    return 'unauthenticated';
  }
  if (error.code !== undefined && CONFLICT_CODES.includes(error.code)) {
    return 'conflict';
  }
  if (status === 404 || status === 403) {
    return 'conflict';
  }
  // A lost compare-and-set race: the command is re-evaluated on the next attempt.
  if (error.code === 'VERSION_CONFLICT' || status === 429 || status >= 500) {
    return 'retryable';
  }
  return 'rejected';
}

/**
 * Exponential backoff with full jitter: a random delay between 0 and
 * min(max, base × 2^(attempt − 1)). Jitter keeps many devices that come back online together
 * from retrying in lockstep.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
  policy: RetryPolicy = RETRY_POLICY,
): number {
  const ceiling = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  return Math.floor(random() * ceiling);
}
