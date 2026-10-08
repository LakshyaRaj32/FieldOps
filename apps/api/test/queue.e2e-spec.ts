import type { AppConfig } from '../src/config/app-config.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import {
  BackgroundTasks,
  DEAD_LETTER_QUEUE,
  PermanentTaskError,
  type DeadLetter,
} from '../src/queue/background-tasks.service.js';
import { OVERDUE_SCAN_TASK } from '../src/shops/overdue.service.js';
import { TEST_REDIS_URL, flushTestRedis } from './helpers/redis.js';
import {
  createTestApp,
  eventually,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';
import {
  bearer,
  createShop,
  createTenant,
  superAdmin,
  type Actor,
} from './helpers/world.js';

/**
 * Background tasks through BullMQ against a real Redis (skipped without TEST_REDIS_URL):
 * retries with backoff, dead-lettering, permanent failures, deduplication, scheduling, and
 * the push.send task end to end. Retries wait 50 ms instead of seconds.
 */
const fastRetries = (config: AppConfig): AppConfig => ({
  ...config,
  queue: { ...config.queue, retryDelayMs: 50 },
});

describe.skipIf(TEST_REDIS_URL === undefined)('Background tasks (e2e)', () => {
  let t: TestApp;
  let tasks: BackgroundTasks;

  beforeAll(async () => {
    await flushTestRedis();
    t = await createTestApp({ configure: fastRetries });
    tasks = t.app.get(BackgroundTasks);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.push.reset();
  });

  afterAll(async () => {
    await t.app.close();
  });

  const deadLetters = async (): Promise<DeadLetter[]> =>
    (await tasks.queue(DEAD_LETTER_QUEUE).getJobs(['waiting'])).map(
      job => job.data as DeadLetter,
    );

  it('retries a failing task with backoff until it succeeds', async () => {
    const attempts: number[] = [];
    tasks.define<{ value: string }>({
      name: 'test.flaky',
      queue: 'maintenance',
      attempts: 4,
      run: (_data, attempt) => {
        attempts.push(attempt);
        return attempt < 3
          ? Promise.reject(new Error('temporary'))
          : Promise.resolve();
      },
    });

    await tasks.enqueue('test.flaky', { value: 'x' });

    await eventually(() => expect(attempts).toEqual([1, 2, 3]), 10_000);
    expect(
      (await deadLetters()).filter(letter => letter.name === 'test.flaky'),
    ).toEqual([]);
  });

  it('dead-letters a task once its attempts run out', async () => {
    let runs = 0;
    tasks.define<{ orderId: string }>({
      name: 'test.broken',
      queue: 'maintenance',
      attempts: 3,
      run: () => {
        runs += 1;
        return Promise.reject(new Error('still broken'));
      },
    });

    await tasks.enqueue('test.broken', { orderId: 'o-1' });

    await eventually(async () => {
      expect(
        (await deadLetters()).filter(letter => letter.name === 'test.broken'),
      ).toEqual([
        {
          queue: 'maintenance',
          name: 'test.broken',
          data: { orderId: 'o-1' },
          error: 'still broken',
          attempts: 3,
          failedAt: expect.any(String),
        },
      ]);
    }, 10_000);
    expect(runs).toBe(3);
  });

  it('does not retry a permanent failure', async () => {
    let runs = 0;
    tasks.define({
      name: 'test.permanent',
      queue: 'maintenance',
      attempts: 5,
      run: () => {
        runs += 1;
        return Promise.reject(new PermanentTaskError('bad input'));
      },
    });

    await tasks.enqueue('test.permanent', {});

    await eventually(async () => {
      const letter = (await deadLetters()).find(
        item => item.name === 'test.permanent',
      );
      expect(letter).toMatchObject({ error: 'bad input', attempts: 1 });
    }, 10_000);
    expect(runs).toBe(1);
  });

  it('runs a task once however often it is enqueued with the same ID', async () => {
    let runs = 0;
    tasks.define({
      name: 'test.once',
      queue: 'maintenance',
      attempts: 1,
      run: () => {
        runs += 1;
        return Promise.resolve();
      },
    });

    await tasks.enqueue('test.once', {}, { id: 'once.1' });
    await eventually(() => expect(runs).toBe(1));
    await tasks.enqueue('test.once', {}, { id: 'once.1' });
    await tasks.enqueue('test.once', {}, { id: 'once.1' });

    await new Promise(resolve => setTimeout(resolve, 300));
    expect(runs).toBe(1);
  });

  it('registers the scheduled maintenance tasks', async () => {
    const schedulers = await tasks.queue('maintenance').getJobSchedulers();

    expect(schedulers.map(item => item.name).sort()).toEqual([
      'sessions.purge-expired',
      'sync.purge-processed-mutations',
    ]);
    // OVERDUE_SCAN_INTERVAL is "off" in the test environment: its schedule is removed.
    expect(schedulers.map(item => item.name)).not.toContain(OVERDUE_SCAN_TASK);
  });

  describe('push.send', () => {
    const TOKEN = `token-q-${'x'.repeat(40)}`;
    let admin: Actor;
    let shopId: string;

    beforeEach(async () => {
      const tenant = await createTenant(t, await superAdmin(t), 'Queue Org');
      admin = tenant.admin;
      shopId = (await createShop(t, admin, 'Queue Shop')).id;
      const registered = await t
        .http()
        .put('/api/v1/notifications/devices/current')
        .set(bearer(admin))
        .send({ token: TOKEN });
      expect(registered.status).toBe(204);
    });

    const notify = () =>
      t.app.get(NotificationsService).deliver([
        {
          userId: admin.id,
          type: 'PAYMENT_OVERDUE',
          jobId: null,
          shopId,
          title: 'Payment overdue',
          body: 'Queue Shop',
        },
      ]);

    it('retries a push while FCM fails, then delivers it once', async () => {
      t.push.failNext = 2;

      await notify();

      await eventually(() => {
        expect(t.push.sent.map(item => item.token)).toEqual([TOKEN]);
      }, 10_000);
      expect(t.push.attempts).toBe(3);
    });

    it('drops the registration FCM says is invalid, without retrying', async () => {
      t.push.invalidTokens.add(TOKEN);

      await notify();

      await eventually(async () => {
        expect(await t.prisma.pushDevice.count()).toBe(0);
      });
      expect(t.push.attempts).toBe(1);
      expect(t.push.sent).toEqual([]);
    });
  });
});
