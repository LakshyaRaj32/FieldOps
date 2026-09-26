import { httpError, networkError } from '../../../testing/fakeJobServer';
import { backoffDelayMs, classifyFailure, RETRY_POLICY } from './retryPolicy';

describe('classifyFailure', () => {
  it.each([
    ['no connection', networkError, 'offline'],
    ['a timeout', { kind: 'timeout', message: 'slow' }, 'offline'],
    ['a server error', httpError(503, 'SERVICE_UNAVAILABLE'), 'retryable'],
    ['an internal error', httpError(500, 'INTERNAL_ERROR'), 'retryable'],
    ['rate limiting', httpError(429, 'TOO_MANY_REQUESTS'), 'retryable'],
    ['a lost version race', httpError(409, 'VERSION_CONFLICT'), 'retryable'],
    ['an unreadable body', { kind: 'parse', message: 'bad' }, 'retryable'],
    [
      'an invalid transition',
      httpError(409, 'INVALID_STATUS_TRANSITION'),
      'conflict',
    ],
    ['a job no longer visible', httpError(404, 'NOT_FOUND'), 'conflict'],
    ['a forbidden command', httpError(403, 'FORBIDDEN'), 'conflict'],
    ['a validation error', httpError(400, 'VALIDATION_ERROR'), 'rejected'],
    [
      'a reused idempotency key',
      httpError(422, 'IDEMPOTENCY_KEY_REUSED'),
      'rejected',
    ],
    ['an ended session', httpError(401, 'SESSION_REVOKED'), 'unauthenticated'],
  ] as const)('treats %s as %s', (_case, error, kind) => {
    expect(classifyFailure(error)).toBe(kind);
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially up to the cap (upper bound with random = 1)', () => {
    const upper = (attempt: number) => backoffDelayMs(attempt, () => 0.9999);
    expect(upper(1)).toBeLessThan(RETRY_POLICY.baseDelayMs);
    expect(upper(2)).toBeLessThan(2 * RETRY_POLICY.baseDelayMs);
    expect(upper(3)).toBeGreaterThan(2 * RETRY_POLICY.baseDelayMs);
    expect(upper(30)).toBeLessThan(RETRY_POLICY.maxDelayMs);
    expect(upper(30)).toBeGreaterThan(RETRY_POLICY.maxDelayMs * 0.99);
  });

  it('spreads retries with full jitter', () => {
    expect(backoffDelayMs(5, () => 0)).toBe(0);
    expect(backoffDelayMs(5, () => 0.5)).toBe(
      (RETRY_POLICY.baseDelayMs * 2 ** 4) / 2,
    );
  });
});
