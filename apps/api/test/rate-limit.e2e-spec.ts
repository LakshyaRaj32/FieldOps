import type { AppConfig } from '../src/config/app-config.js';
import { flushTestRedis } from './helpers/redis.js';
import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';
import { PASSWORD, bearer, codeOf, registerAccount } from './helpers/world.js';

/**
 * Rate limiting through the real HTTP pipeline. Runs against Redis when TEST_REDIS_URL is
 * set and against the in-memory fallback otherwise; the behaviour must be the same.
 * Small policies keep the tests fast: 3 sign-ins per window, a bucket of 5 requests.
 */
const smallPolicies = (config: AppConfig): AppConfig => ({
  ...config,
  rateLimit: {
    enabled: true,
    policies: {
      ...config.rateLimit.policies,
      auth: { ...config.rateLimit.policies.auth, limit: 3 },
      default: { ...config.rateLimit.policies.default, limit: 5 },
    },
  },
});

describe('Rate limiting (e2e)', () => {
  let t: TestApp;

  beforeEach(async () => {
    // A new app per test: fresh in-memory counters; the flush resets the Redis ones.
    await flushTestRedis();
    t = await createTestApp({ configure: smallPolicies });
    await resetDatabase(t.prisma);
  });

  afterEach(async () => {
    await t.app.close();
  });

  const login = () =>
    t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

  it('refuses sign-in attempts over the limit with 429 and Retry-After', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await login();
      // Failed attempts count: that is what stops password guessing.
      expect(response.status).toBe(401);
      expect(response.headers['ratelimit-remaining']).toBe(String(3 - attempt));
    }

    const refused = await login();

    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringMatching(
          /^Too many requests\. Try again in \d+ seconds?\.$/,
        ),
        requestId: expect.any(String),
      },
    });
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);
    expect(refused.headers['ratelimit-limit']).toBe('3');
    expect(refused.headers['ratelimit-remaining']).toBe('0');
    expect(refused.headers['ratelimit-policy']).toBe('3;w=300');
  });

  it('counts signed-in users separately, whatever their IP', async () => {
    const first = await registerAccount(t, 'First');
    const second = await registerAccount(t, 'Second');
    const me = (actor: typeof first) =>
      t.http().get('/api/v1/auth/me').set(bearer(actor));

    for (let request = 1; request <= 5; request += 1) {
      const response = await me(first);
      expect(response.status).toBe(200);
      expect(response.headers['ratelimit-limit']).toBe('5');
    }
    const refused = await me(first);
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe('TOO_MANY_REQUESTS');

    // Same IP (127.0.0.1), different user: a separate bucket.
    const other = await me(second);
    expect(other.status).toBe(200);
    expect(other.headers['ratelimit-remaining']).toBe('4');
  });

  it('never limits the health probes', async () => {
    for (let request = 0; request < 10; request += 1) {
      const response = await t.http().get('/health/live');
      expect(response.status).toBe(200);
      expect(response.headers['ratelimit-limit']).toBeUndefined();
    }
  });
});
