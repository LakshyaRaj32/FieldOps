import { SetMetadata } from '@nestjs/common';

import type { RateLimitPolicyName } from './rate-limit.policies.js';

export const RATE_LIMIT_POLICY_KEY = 'fieldops:rateLimitPolicy';

/** Sentinel policy: the route is not rate limited. */
export const NO_RATE_LIMIT = 'none';

/**
 * Applies a rate-limit policy (rate-limit.policies.ts) to a route or controller instead of
 * `default`. Every route is limited by `default` unless it says otherwise.
 */
export const RateLimit = (
  policy: RateLimitPolicyName,
): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policy);

/** Exempts a route from rate limiting (platform health probes). */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, NO_RATE_LIMIT);
