/**
 * The rate-limit policies (docs/rate-limiting.md). Each route uses `default` unless it is
 * decorated with @RateLimit(name) or @SkipRateLimit().
 *
 * The values are starting points, not proven production numbers: each can be overridden per
 * deployment with RATE_LIMIT_<NAME>=<limit>/<window> (for example RATE_LIMIT_AUTH=50/5m),
 * and they should be revisited with real traffic (Phase 6 load tests).
 */

export const RATE_LIMIT_ALGORITHMS = [
  'fixed-window',
  'sliding-window',
  'token-bucket',
] as const;
export type RateLimitAlgorithm = (typeof RATE_LIMIT_ALGORITHMS)[number];

/**
 * Who a counter belongs to. `user-or-ip`: the signed-in user (all their devices share it),
 * or the client IP for anonymous requests. `ip`: always the client IP, used where the caller
 * is not known yet (sign-in), so guessing passwords for many accounts shares one counter.
 */
export type RateLimitKey = 'user-or-ip' | 'ip';

export interface RateLimitPolicy {
  readonly name: RateLimitPolicyName;
  readonly algorithm: RateLimitAlgorithm;
  /** Requests per window; for the token bucket, its capacity (the largest burst). */
  readonly limit: number;
  /** The window; for the token bucket, the time to refill completely from empty. */
  readonly windowMs: number;
  readonly key: RateLimitKey;
}

export const RATE_LIMIT_POLICY_NAMES = [
  'default',
  'auth',
  'refresh',
  'upload',
] as const;
export type RateLimitPolicyName = (typeof RATE_LIMIT_POLICY_NAMES)[number];

const MINUTE = 60_000;

export const DEFAULT_RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitPolicyName, RateLimitPolicy>
> = {
  /**
   * Every authenticated route. A token bucket allows the burst a phone sends when it comes
   * back online and drains its outbox, while holding the sustained rate to 2 per second.
   */
  default: {
    name: 'default',
    algorithm: 'token-bucket',
    limit: 120,
    windowMs: MINUTE,
    key: 'user-or-ip',
  },
  /**
   * Sign-in and registration: password guessing. A sliding window, so a client cannot send
   * twice the limit across a window boundary (which a fixed window allows).
   */
  auth: {
    name: 'auth',
    algorithm: 'sliding-window',
    limit: 20,
    windowMs: 5 * MINUTE,
    key: 'ip',
  },
  /**
   * Token refresh. Each device refreshes about every 15 minutes, so this only stops a
   * runaway client. A fixed window is enough here and the cheapest to compute.
   */
  refresh: {
    name: 'refresh',
    algorithm: 'fixed-window',
    limit: 60,
    windowMs: MINUTE,
    key: 'ip',
  },
  /** Evidence uploads: each one writes a file to disk. */
  upload: {
    name: 'upload',
    algorithm: 'fixed-window',
    limit: 60,
    windowMs: MINUTE,
    key: 'user-or-ip',
  },
};

export function isRateLimitPolicyName(
  value: string,
): value is RateLimitPolicyName {
  return (RATE_LIMIT_POLICY_NAMES as readonly string[]).includes(value);
}
