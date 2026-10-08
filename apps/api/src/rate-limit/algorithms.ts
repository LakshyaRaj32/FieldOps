/**
 * The three rate-limiting algorithms as pure functions of (state, policy, now). The in-memory
 * store runs them directly; the Redis store runs the same arithmetic in Lua
 * (redis-scripts.ts), atomically on the server. Keep the two in step: the unit tests pin the
 * behaviour here, the Redis E2E test pins the scripts to the same expectations.
 */

import type { RateLimitPolicy } from './rate-limit.policies.js';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Requests still allowed right now. */
  readonly remaining: number;
  /** Milliseconds until the quota is fully available again. */
  readonly resetMs: number;
  /** Milliseconds to wait before retrying; 0 when allowed. */
  readonly retryAfterMs: number;
}

export interface FixedWindowState {
  readonly windowStart: number;
  readonly count: number;
}

export interface SlidingWindowState {
  /** Times of the accepted requests still inside the window, oldest first. */
  readonly hits: readonly number[];
}

export interface TokenBucketState {
  readonly tokens: number;
  readonly updatedAt: number;
}

export interface Step<State> {
  readonly state: State;
  readonly decision: RateLimitDecision;
  /** When the state can be forgotten (it would be equivalent to no state). */
  readonly expiresAt: number;
}

/**
 * Counts requests in a window that opens with the first request and lasts `windowMs`.
 * Rejected requests are counted too (they do not extend the window). Cheap, but allows up to
 * twice the limit across the boundary of two windows.
 */
export function fixedWindow(
  previous: FixedWindowState | undefined,
  policy: RateLimitPolicy,
  now: number,
): Step<FixedWindowState> {
  const current =
    previous === undefined || now >= previous.windowStart + policy.windowMs
      ? { windowStart: now, count: 0 }
      : previous;
  const state = { windowStart: current.windowStart, count: current.count + 1 };
  const expiresAt = state.windowStart + policy.windowMs;
  const resetMs = expiresAt - now;
  const allowed = state.count <= policy.limit;
  return {
    state,
    expiresAt,
    decision: {
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - state.count),
      resetMs,
      retryAfterMs: allowed ? 0 : resetMs,
    },
  };
}

/**
 * Sliding window log: remembers the time of each accepted request and allows a new one while
 * fewer than `limit` happened in the last `windowMs`. Exact, at the cost of one entry per
 * accepted request, so it suits small limits (sign-in).
 */
export function slidingWindow(
  previous: SlidingWindowState | undefined,
  policy: RateLimitPolicy,
  now: number,
): Step<SlidingWindowState> {
  const hits = (previous?.hits ?? []).filter(
    hit => hit > now - policy.windowMs,
  );
  const allowed = hits.length < policy.limit;
  if (allowed) {
    hits.push(now);
  }
  const oldest = hits[0] ?? now;
  const newest = hits.at(-1) ?? now;
  const untilOldestLeaves = oldest + policy.windowMs - now;
  return {
    state: { hits },
    expiresAt: newest + policy.windowMs,
    decision: {
      allowed,
      limit: policy.limit,
      remaining: policy.limit - hits.length,
      resetMs: newest + policy.windowMs - now,
      retryAfterMs: allowed ? 0 : untilOldestLeaves,
    },
  };
}

/**
 * Token bucket: holds up to `limit` tokens and refills `limit` per `windowMs`, continuously.
 * Each request takes one token. Allows bursts up to the capacity and a steady rate after.
 */
export function tokenBucket(
  previous: TokenBucketState | undefined,
  policy: RateLimitPolicy,
  now: number,
): Step<TokenBucketState> {
  const ratePerMs = policy.limit / policy.windowMs;
  const elapsed = Math.max(0, now - (previous?.updatedAt ?? now));
  let tokens = Math.min(
    policy.limit,
    (previous?.tokens ?? policy.limit) + elapsed * ratePerMs,
  );
  const allowed = tokens >= 1;
  if (allowed) {
    tokens -= 1;
  }
  const untilFull = Math.max(1, Math.ceil((policy.limit - tokens) / ratePerMs));
  return {
    state: { tokens, updatedAt: now },
    expiresAt: now + untilFull,
    decision: {
      allowed,
      limit: policy.limit,
      remaining: Math.floor(tokens),
      resetMs: untilFull,
      retryAfterMs: allowed ? 0 : Math.ceil((1 - tokens) / ratePerMs),
    },
  };
}
