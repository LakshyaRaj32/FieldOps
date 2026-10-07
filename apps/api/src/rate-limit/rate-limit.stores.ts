import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import {
  fixedWindow,
  slidingWindow,
  tokenBucket,
  type RateLimitDecision,
  type Step,
} from './algorithms.js';
import type {
  RateLimitAlgorithm,
  RateLimitPolicy,
} from './rate-limit.policies.js';
import {
  FIXED_WINDOW_SCRIPT,
  SLIDING_WINDOW_SCRIPT,
  TOKEN_BUCKET_SCRIPT,
} from './redis-scripts.js';

export interface RateLimitStore {
  /** Counts one request against `key` under `policy` and says whether it may proceed. */
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}

type ScriptReply = [number, number, number, number];

interface RateLimitCommands {
  rateLimitFixedWindow(...args: (string | number)[]): Promise<ScriptReply>;
  rateLimitSlidingWindow(...args: (string | number)[]): Promise<ScriptReply>;
  rateLimitTokenBucket(...args: (string | number)[]): Promise<ScriptReply>;
}

const COMMAND_OF: Readonly<
  Record<RateLimitAlgorithm, keyof RateLimitCommands>
> = {
  'fixed-window': 'rateLimitFixedWindow',
  'sliding-window': 'rateLimitSlidingWindow',
  'token-bucket': 'rateLimitTokenBucket',
};

/**
 * Shared counters in Redis: every API instance sees the same counts. The scripts are sent
 * once and then run by SHA (ioredis defineCommand), so each request is one round trip.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis & RateLimitCommands;

  constructor(redis: Redis) {
    redis.defineCommand('rateLimitFixedWindow', {
      numberOfKeys: 1,
      lua: FIXED_WINDOW_SCRIPT,
    });
    redis.defineCommand('rateLimitSlidingWindow', {
      numberOfKeys: 1,
      lua: SLIDING_WINDOW_SCRIPT,
    });
    redis.defineCommand('rateLimitTokenBucket', {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_SCRIPT,
    });
    this.redis = redis as Redis & RateLimitCommands;
  }

  async consume(
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    const [allowed, remaining, resetMs, retryAfterMs] = await this.redis[
      COMMAND_OF[policy.algorithm]
    ](key, policy.limit, policy.windowMs, randomUUID());
    return {
      allowed: allowed === 1,
      limit: policy.limit,
      remaining,
      resetMs,
      retryAfterMs,
    };
  }
}

interface Entry {
  readonly state: unknown;
  readonly expiresAt: number;
}

/** Forget expired entries once the map grows past this many keys. */
const SWEEP_THRESHOLD = 10_000;

/**
 * Counters in this process's memory: used when Redis is not configured or is unreachable.
 * Correct for one instance; with several, each enforces the limit separately (so a client
 * can get up to N times the limit). Single-threaded JavaScript makes each step atomic.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: () => number = Date.now) {}

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const now = this.clock();
    const stored = this.entries.get(key);
    const previous =
      stored !== undefined && stored.expiresAt > now ? stored.state : undefined;
    const step = this.step(previous, policy, now);
    this.entries.set(key, { state: step.state, expiresAt: step.expiresAt });
    if (this.entries.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }
    return Promise.resolve(step.decision);
  }

  /** Number of keys held (tests). */
  get size(): number {
    return this.entries.size;
  }

  private step(
    previous: unknown,
    policy: RateLimitPolicy,
    now: number,
  ): Step<unknown> {
    // Keys include the policy name, so a key's state always has its policy's shape.
    switch (policy.algorithm) {
      case 'fixed-window':
        return fixedWindow(previous as never, policy, now);
      case 'sliding-window':
        return slidingWindow(previous as never, policy, now);
      case 'token-bucket':
        return tokenBucket(previous as never, policy, now);
    }
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
