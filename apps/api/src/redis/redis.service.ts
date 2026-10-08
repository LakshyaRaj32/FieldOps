import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export type RedisStatus = 'up' | 'down' | 'disabled';

/**
 * The process's one Redis connection (docs/redis.md), or none when REDIS_URL is empty.
 *
 * Redis is never the source of truth: PostgreSQL is. Everything built on it has a fallback
 * (the cache reads the database, the rate limiter counts in memory), so callers check
 * `available()` and treat any command error as "Redis is down" rather than failing the
 * request.
 *
 * Commands fail fast while disconnected (no offline queue, one retry): a request must not
 * wait for Redis to come back. The client keeps reconnecting in the background.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  /** Null when Redis is not configured. */
  readonly client: Redis | null;
  private wasReady = false;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.redis.url === undefined) {
      this.client = null;
      if (config.environment !== 'development') {
        this.logger.warn(
          'REDIS_URL is not set: caching is off and rate limits are counted per instance.',
        );
      }
      return;
    }
    this.client = new Redis(config.redis.url, {
      keyPrefix: config.redis.keyPrefix,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      retryStrategy: attempt => Math.min(attempt * 500, 5_000),
    });
    // Without a listener, a connection error would be an unhandled 'error' event. Log the
    // transitions only, not every reconnection attempt.
    this.client.on('error', (error: Error) => {
      if (this.wasReady) {
        this.wasReady = false;
        this.logger.error(`Redis connection lost: ${error.message}`);
      }
    });
    this.client.on('ready', () => {
      this.wasReady = true;
      this.logger.log('Redis connected');
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client === null) {
      return;
    }
    try {
      await this.client.connect();
    } catch (error) {
      // Start anyway: the fallbacks take over and the client keeps retrying.
      this.logger.warn(
        `Redis unavailable at startup (${error instanceof Error ? error.message : String(error)}); retrying in the background.`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client === null) {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  /** Connected and accepting commands right now. */
  available(): boolean {
    return this.client?.status === 'ready';
  }

  status(): RedisStatus {
    if (this.client === null) {
      return 'disabled';
    }
    return this.available() ? 'up' : 'down';
  }
}
