import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { RedisService } from '../redis/redis.service.js';

/** Bump when a cached value's shape changes, so old entries are never read. */
const CACHE_VERSION = 'v1';

/** Expiry of a key's generation counter; refreshed by every invalidation. */
const GENERATION_TTL_SECONDS = 86_400;

/** Spreads expiries by ±10% so entries filled together do not all expire together. */
const TTL_JITTER = 0.1;

/** At most one "cache unavailable" warning per this many milliseconds. */
const WARNING_INTERVAL_MS = 60_000;

/**
 * Stores the value only if the key's generation is still the one read before loading it,
 * i.e. nothing invalidated the key while the value was being read from PostgreSQL.
 * KEYS[1]: value, KEYS[2]: generation. ARGV[1]: expected generation, ARGV[2]: value,
 * ARGV[3]: TTL (ms).
 */
const FILL_SCRIPT = `
local generation = redis.call('GET', KEYS[2]) or '0'
if generation ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

interface CacheCommands {
  cacheFill(
    valueKey: string,
    generationKey: string,
    generation: string,
    value: string,
    ttlMs: number,
  ): Promise<number>;
}

export interface CacheOptions {
  /** Upper bound on how stale a value can be if an invalidation is lost. */
  readonly ttlSeconds: number;
}

/**
 * Cache-aside over Redis (docs/redis.md, "Caching"). PostgreSQL stays the source of truth:
 * a miss, a Redis error or no Redis at all simply reads the database.
 *
 * Writers call `invalidate` AFTER their transaction commits. That bumps the key's generation
 * and deletes the value. A reader that loaded the old row before the commit then fails its
 * generation check and does not store it, so a slow read can never put stale data back.
 *
 * Stampede protection: concurrent misses for one key in this process share one database
 * read. Across instances each may read once, which is acceptable for these small lookups.
 *
 * Only cache values that are cheap to be briefly wrong about between a commit and its
 * invalidation; writes that depend on a value (prices on a new order) read PostgreSQL.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: (Redis & CacheCommands) | null;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private lastWarning = 0;

  constructor(private readonly connection: RedisService) {
    const client = connection.client;
    if (client !== null) {
      client.defineCommand('cacheFill', { numberOfKeys: 2, lua: FILL_SCRIPT });
    }
    this.redis = client as (Redis & CacheCommands) | null;
  }

  async getOrLoad<T>(
    key: string,
    options: CacheOptions,
    load: () => Promise<T>,
  ): Promise<T> {
    if (this.redis === null || !this.connection.available()) {
      return load();
    }
    const cached = await this.read<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      return pending as Promise<T>;
    }
    const loading = this.loadAndFill(this.redis, key, options, load).finally(
      () => {
        if (this.inFlight.get(key) === loading) {
          this.inFlight.delete(key);
        }
      },
    );
    this.inFlight.set(key, loading);
    return loading;
  }

  /** Call after the change is committed. Never throws: a failure is logged. */
  async invalidate(...keys: string[]): Promise<void> {
    if (this.redis === null || keys.length === 0) {
      return;
    }
    // Readers arriving from now on must not join a load that may have read the old row.
    for (const key of keys) {
      this.inFlight.delete(key);
    }
    try {
      const transaction = this.redis.multi();
      for (const key of keys) {
        transaction
          .incr(generationKey(key))
          .expire(generationKey(key), GENERATION_TTL_SECONDS)
          .del(valueKey(key));
      }
      await transaction.exec();
    } catch (error) {
      // The value stays until its TTL expires: the bound on staleness.
      this.logger.error(
        `Cache invalidation failed for ${keys.join(', ')}: ${messageOf(error)}`,
      );
    }
  }

  private async read<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis?.get(valueKey(key));
      return raw === null || raw === undefined
        ? undefined
        : (JSON.parse(raw) as T);
    } catch (error) {
      this.warn(error);
      return undefined;
    }
  }

  private async loadAndFill<T>(
    redis: Redis & CacheCommands,
    key: string,
    options: CacheOptions,
    load: () => Promise<T>,
  ): Promise<T> {
    let generation: string | undefined;
    try {
      generation = (await redis.get(generationKey(key))) ?? '0';
    } catch (error) {
      this.warn(error);
    }
    const value = await load();
    if (generation !== undefined) {
      const jitter = 1 + (Math.random() * 2 - 1) * TTL_JITTER;
      try {
        await redis.cacheFill(
          valueKey(key),
          generationKey(key),
          generation,
          JSON.stringify(value),
          Math.round(options.ttlSeconds * 1000 * jitter),
        );
      } catch (error) {
        this.warn(error);
      }
    }
    return value;
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarning >= WARNING_INTERVAL_MS) {
      this.lastWarning = now;
      this.logger.warn(
        `Cache unavailable, reading the database: ${messageOf(error)}`,
      );
    }
  }
}

const valueKey = (key: string): string => `cache:${CACHE_VERSION}:${key}`;
const generationKey = (key: string): string =>
  `cache:${CACHE_VERSION}:${key}:gen`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
