import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { RedisService } from '../redis/redis.service.js';
import type { RateLimitDecision } from './algorithms.js';
import type {
  RateLimitPolicy,
  RateLimitPolicyName,
} from './rate-limit.policies.js';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from './rate-limit.stores.js';

/** At most one "Redis failed, counting locally" warning per this many milliseconds. */
const FALLBACK_WARNING_INTERVAL_MS = 60_000;

/**
 * Counts requests per policy and client. Uses Redis (shared by every instance) when it is
 * reachable and falls back to this process's memory otherwise: if Redis goes down, limits
 * stay enforced per instance instead of disappearing, and requests are never refused because
 * Redis is down.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redisStore: RateLimitStore | null;
  private readonly memoryStore = new MemoryRateLimitStore();
  private lastFallbackWarning = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.redisStore =
      redis.client === null ? null : new RedisRateLimitStore(redis.client);
  }

  get enabled(): boolean {
    return this.config.rateLimit.enabled;
  }

  policy(name: RateLimitPolicyName): RateLimitPolicy {
    return this.config.rateLimit.policies[name];
  }

  /** `identity` is "u:<userId>" or "ip:<address>". */
  async consume(
    policy: RateLimitPolicy,
    identity: string,
  ): Promise<RateLimitDecision> {
    const key = `rl:${policy.name}:${identity}`;
    if (this.redisStore !== null && this.redis.available()) {
      try {
        return await this.redisStore.consume(key, policy);
      } catch (error) {
        this.warnFallback(error);
      }
    }
    return this.memoryStore.consume(key, policy);
  }

  private warnFallback(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFallbackWarning < FALLBACK_WARNING_INTERVAL_MS) {
      return;
    }
    this.lastFallbackWarning = now;
    this.logger.warn(
      `Rate limiting falls back to local counters: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
