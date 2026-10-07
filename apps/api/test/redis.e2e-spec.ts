import { randomUUID } from 'node:crypto';

import { CacheService } from '../src/cache/cache.service.js';
import { parseAppConfig, type AppConfig } from '../src/config/app-config.js';
import type { RateLimitPolicy } from '../src/rate-limit/rate-limit.policies.js';
import { RateLimiterService } from '../src/rate-limit/rate-limiter.service.js';
import { RedisRateLimitStore } from '../src/rate-limit/rate-limit.stores.js';
import { RedisService } from '../src/redis/redis.service.js';
import { TEST_REDIS_URL, flushTestRedis } from './helpers/redis.js';

/**
 * The Redis side of rate limiting and caching, against a real Redis (skipped without
 * TEST_REDIS_URL). The Lua scripts must agree with algorithms.ts (unit-tested), be atomic
 * under concurrency and be shared by every instance; the cache must never keep a value
 * read before an invalidation.
 */

const configFor = (url: string | undefined): AppConfig => {
  const config = parseAppConfig(process.env);
  return { ...config, redis: { ...config.redis, url } };
};

async function connect(url: string | undefined): Promise<RedisService> {
  const redis = new RedisService(configFor(url));
  await redis.onModuleInit();
  return redis;
}

const policy = (
  algorithm: RateLimitPolicy['algorithm'],
  limit: number,
  windowMs: number,
): RateLimitPolicy => ({
  name: 'default',
  algorithm,
  limit,
  windowMs,
  key: 'user-or-ip',
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(TEST_REDIS_URL === undefined)('Redis (e2e)', () => {
  let redis: RedisService;
  let other: RedisService;

  beforeAll(async () => {
    redis = await connect(TEST_REDIS_URL);
    // A second connection stands in for a second API instance.
    other = await connect(TEST_REDIS_URL);
  });

  beforeEach(async () => {
    await flushTestRedis();
  });

  afterAll(async () => {
    await redis.onApplicationShutdown();
    await other.onApplicationShutdown();
  });

  describe('rate-limit scripts', () => {
    const consumeMany = async (
      store: RedisRateLimitStore,
      key: string,
      p: RateLimitPolicy,
      count: number,
    ) => {
      const decisions = [];
      for (let i = 0; i < count; i += 1) {
        decisions.push(await store.consume(key, p));
      }
      return decisions;
    };

    it.each([
      ['fixed-window', 5],
      ['sliding-window', 5],
      ['token-bucket', 5],
    ] as const)(
      '%s allows exactly the limit, then refuses with a retry delay',
      async (algorithm, limit) => {
        const store = new RedisRateLimitStore(redis.client!);
        const p = policy(algorithm, limit, 60_000);

        const decisions = await consumeMany(store, randomUUID(), p, limit + 1);

        expect(decisions.map(d => d.allowed)).toEqual([
          ...Array<boolean>(limit).fill(true),
          false,
        ]);
        expect(decisions.map(d => d.remaining)).toEqual([4, 3, 2, 1, 0, 0]);
        const refused = decisions.at(-1)!;
        expect(refused.retryAfterMs).toBeGreaterThan(0);
        expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
      },
    );

    it('shares counters between instances', async () => {
      const key = randomUUID();
      const p = policy('sliding-window', 4, 60_000);
      const first = new RedisRateLimitStore(redis.client!);
      const second = new RedisRateLimitStore(other.client!);

      const results = [];
      for (const store of [first, second, first, second, first]) {
        results.push((await store.consume(key, p)).allowed);
      }

      expect(results).toEqual([true, true, true, true, false]);
    });

    it.each(['fixed-window', 'sliding-window', 'token-bucket'] as const)(
      '%s is atomic: concurrent requests from two instances never exceed the limit',
      async algorithm => {
        const key = randomUUID();
        const p = policy(algorithm, 10, 60_000);
        const stores = [
          new RedisRateLimitStore(redis.client!),
          new RedisRateLimitStore(other.client!),
        ];

        const decisions = await Promise.all(
          Array.from({ length: 60 }, (_, i) => stores[i % 2]!.consume(key, p)),
        );

        expect(decisions.filter(d => d.allowed)).toHaveLength(10);
      },
    );

    it('refills the token bucket over time and expires idle windows', async () => {
      const store = new RedisRateLimitStore(redis.client!);
      // 10 tokens per second: one every 100 ms.
      const bucket = policy('token-bucket', 10, 1_000);
      const key = randomUUID();
      await consumeMany(store, key, bucket, 10);
      expect((await store.consume(key, bucket)).allowed).toBe(false);
      await delay(150);
      expect((await store.consume(key, bucket)).allowed).toBe(true);

      const window = policy('fixed-window', 1, 200);
      const windowKey = randomUUID();
      expect((await store.consume(windowKey, window)).allowed).toBe(true);
      expect((await store.consume(windowKey, window)).allowed).toBe(false);
      await delay(250);
      expect((await store.consume(windowKey, window)).allowed).toBe(true);
    });
  });

  describe('cache', () => {
    it('reads the database once, then serves hits until invalidated', async () => {
      const cache = new CacheService(redis);
      const key = `test:${randomUUID()}`;
      let loads = 0;
      const load = () => Promise.resolve({ value: (loads += 1) });

      expect(await cache.getOrLoad(key, { ttlSeconds: 60 }, load)).toEqual({
        value: 1,
      });
      expect(await cache.getOrLoad(key, { ttlSeconds: 60 }, load)).toEqual({
        value: 1,
      });
      // Another instance sees the same entry.
      const elsewhere = new CacheService(other);
      expect(await elsewhere.getOrLoad(key, { ttlSeconds: 60 }, load)).toEqual({
        value: 1,
      });
      expect(loads).toBe(1);

      await elsewhere.invalidate(key);

      expect(await cache.getOrLoad(key, { ttlSeconds: 60 }, load)).toEqual({
        value: 2,
      });
      expect(loads).toBe(2);
    });

    it('does not store a value read before a concurrent invalidation', async () => {
      const cache = new CacheService(redis);
      const key = `test:${randomUUID()}`;
      let release: () => void = () => undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });

      // A slow reader loads the old row...
      const slow = cache.getOrLoad(key, { ttlSeconds: 60 }, async () => {
        await gate;
        return 'old';
      });
      // ...while a writer commits and invalidates (on another instance).
      await delay(20);
      await new CacheService(other).invalidate(key);
      release();
      expect(await slow).toBe('old');

      // The old value was not cached: the next read goes to the database.
      expect(
        await cache.getOrLoad(key, { ttlSeconds: 60 }, () =>
          Promise.resolve('new'),
        ),
      ).toBe('new');
    });

    it('shares one database read between concurrent misses', async () => {
      const cache = new CacheService(redis);
      const key = `test:${randomUUID()}`;
      let loads = 0;
      const load = async () => {
        loads += 1;
        await delay(30);
        return 'value';
      };

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          cache.getOrLoad(key, { ttlSeconds: 60 }, load),
        ),
      );

      expect(results).toEqual(Array<string>(10).fill('value'));
      expect(loads).toBe(1);
    });

    it('expires entries after their TTL', async () => {
      const cache = new CacheService(redis);
      const key = `test:${randomUUID()}`;
      let loads = 0;
      const load = () => Promise.resolve((loads += 1));

      await cache.getOrLoad(key, { ttlSeconds: 0.2 }, load);
      await delay(300);
      await cache.getOrLoad(key, { ttlSeconds: 0.2 }, load);

      expect(loads).toBe(2);
    });
  });
});

describe('Redis unreachable (e2e)', () => {
  let redis: RedisService;

  beforeAll(async () => {
    // Nothing listens on port 1: the connection fails and keeps retrying in the background.
    redis = await connect('redis://127.0.0.1:1');
  });

  afterAll(async () => {
    await redis.onApplicationShutdown();
  });

  it('reports Redis as down', () => {
    expect(redis.status()).toBe('down');
  });

  it('reads through to the database', async () => {
    const cache = new CacheService(redis);
    let loads = 0;
    const load = () => Promise.resolve((loads += 1));

    await cache.getOrLoad('test:down', { ttlSeconds: 60 }, load);
    await cache.getOrLoad('test:down', { ttlSeconds: 60 }, load);
    await cache.invalidate('test:down');

    expect(loads).toBe(2);
  });

  it('keeps enforcing limits with local counters', async () => {
    const config = configFor('redis://127.0.0.1:1');
    const limiter = new RateLimiterService(config, redis);
    const p = policy('fixed-window', 2, 60_000);

    const allowed = [];
    for (let i = 0; i < 3; i += 1) {
      allowed.push((await limiter.consume(p, 'ip:192.0.2.1')).allowed);
    }

    expect(allowed).toEqual([true, true, false]);
  });
});
