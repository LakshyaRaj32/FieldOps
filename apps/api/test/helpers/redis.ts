import { Redis } from 'ioredis';

import { TEST_ENV } from '../test-env.js';

/** The Redis the suite runs against, or undefined (TEST_REDIS_URL not set). */
export const TEST_REDIS_URL =
  TEST_ENV.REDIS_URL === '' ? undefined : TEST_ENV.REDIS_URL;

/**
 * Deletes the suite's keys (REDIS_KEY_PREFIX) and nothing else, so a shared development
 * Redis keeps its own data. Uses its own client: the app's client prefixes every key, which
 * SCAN patterns do not get.
 */
export async function flushTestRedis(): Promise<void> {
  if (TEST_REDIS_URL === undefined) {
    return;
  }
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${TEST_ENV.REDIS_KEY_PREFIX}*`,
        'COUNT',
        500,
      );
      cursor = next;
      if (keys.length > 0) {
        await redis.unlink(...keys);
      }
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
