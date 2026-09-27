import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type {
  AppNotification,
  AuthResult,
  JobDetail,
  JobWorkingSet,
  NotificationPage,
  Role,
} from '@fieldops/types';

import {
  createTestApp,
  eventually,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

/**
 * Phase 4 (Field Operations) over the real HTTP pipeline and PostgreSQL: location on job
 * commands, photo evidence, job messages, notifications and push registration. Only FCM is
 * faked (RecordingPushSender).
 */

// ---- A minimal but structurally valid JPEG (see evidence-image.spec.ts) ---------------

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff00 | marker, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function jpeg(width: number, height: number, withExif = true): Buffer {
  const sof = Buffer.alloc(6);
  sof.writeUInt8(8, 0);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof.writeUInt8(1, 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(withExif
      ? [
          segment(
            0xe1,
            Buffer.from('Exif\0\0GPS 28.6139N 77.2090E', 'latin1'),
          ),
        ]
      : []),
    segment(0xc0, sof),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('Field operations (e2e)', () => {
  let t: TestApp;
  let manager: Actor;
  let workerA: Actor;
  let workerB: Actor;

  interface Actor {
    readonly id: string;
    readonly token: string;
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await rm(t.config.storageDir, { recursive: true, force: true });
  });

  async function signUp(name: string, role: Role): Promise<Actor> {
    const response = await t
      .http()
      .post('/api/v1/auth/register')
      .send({
        email: `${name}@example.com`,
        password: 'correct horse battery staple',
        firstName: name,
        lastName: 'Test',
      });
    const { user, tokens } = (response.body as { data: AuthResult }).data;
    if (role !== 'WORKER') {
      await t.prisma.user.update({ where: { id: user.id }, data: { role } });
    }
    return { id: user.id, token: tokens.accessToken };
  }

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.push.reset();
    manager = await signUp('manager', 'MANAGER');
    workerA = await signUp('worker-a', 'WORKER');
    workerB = await signUp('worker-b', 'WORKER');
  });

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
  const dataOf = <T>(response: { body: unknown }): T =>
    (response.body as { data: T }).data;
  const codeOf = (response: { body: unknown }): string =>
    (response.body as { error: { code: string } }).error.code;

  const post = (actor: Actor, path: string, body: object = {}) =>
    t.http().post(`/api/v1${path}`).set(as(actor)).send(body);
  const get = (actor: Actor, path: string) =>
    t.http().get(`/api/v1${path}`).set(as(actor));

  async function assignedJob(
    worker: Actor = workerA,
    overrides: Record<string, unknown> = {},
  ): Promise<JobDetail> {
    const created = await post(manager, '/jobs', {
      title: 'AC repair',
      customerName: 'ABC Ltd',
      address: 'Connaught Place, New Delhi',
      location: { latitude: 28.6139, longitude: 77.209 },
      scheduledAt: '2026-09-28T10:30:00+05:30',
      ...overrides,
    });
    const job = dataOf<JobDetail>(created);
    return dataOf<JobDetail>(
      await post(manager, `/jobs/${job.id}/assign`, { workerId: worker.id }),
    );
  }

  const fix = (overrides: Record<string, unknown> = {}) => ({
    latitude: 28.6149,
    longitude: 77.209,
    accuracyMeters: 9,
    capturedAt: '2026-09-28T10:31:00+05:30',
    ...overrides,
  });

  // ---- Location --------------------------------------------------------------------------

  describe('location on start and complete', () => {
    it('records where the job was started and completed, with a server-computed distance', async () => {
      const job = await assignedJob();

      const started = await post(workerA, `/jobs/${job.id}/start`, {
        location: fix(),
      });
      expect(started.status).toBe(200);
      expect(dataOf<JobDetail>(started).startLocation).toEqual({
        latitude: 28.6149,
        longitude: 77.209,
        accuracyMeters: 9,
        capturedAt: '2026-09-28T05:01:00.000Z',
        distanceMeters: 111,
      });

      const completed = await post(workerA, `/jobs/${job.id}/complete`, {
        location: fix({ latitude: 28.6139 }),
      });
      expect(dataOf<JobDetail>(completed).completeLocation).toMatchObject({
        distanceMeters: 0,
      });

      // Managers see it too, and it is part of the worker's offline snapshot.
      const forManager = dataOf<JobDetail>(await get(manager, `/jobs/${job.id}`));
      expect(forManager.startLocation?.distanceMeters).toBe(111);
      const set = dataOf<JobWorkingSet>(await get(workerA, '/jobs/working-set'));
      expect(set.jobs[0]?.completeLocation?.distanceMeters).toBe(0);
    });

    it('works without a location (no fix, or an old app)', async () => {
      const job = await assignedJob();
      const started = await post(workerA, `/jobs/${job.id}/start`);
      expect(started.status).toBe(200);
      expect(dataOf<JobDetail>(started).startLocation).toBeNull();
    });

    it('records the fix without a distance when the job has no coordinates', async () => {
      const job = await assignedJob(workerA, { location: undefined });
      const started = await post(workerA, `/jobs/${job.id}/start`, {
        location: fix(),
      });
      expect(dataOf<JobDetail>(started).startLocation).toMatchObject({
        latitude: 28.6149,
        distanceMeters: null,
      });
    });

    it('rejects impossible coordinates and client-supplied extras', async () => {
      const job = await assignedJob();
      for (const location of [
        fix({ latitude: 91 }),
        fix({ accuracyMeters: -1 }),
        fix({ capturedAt: '2026-09-28T10:31:00' }),
        { ...fix(), distanceMeters: 0 },
      ]) {
        const response = await post(workerA, `/jobs/${job.id}/start`, {
          location,
        });
        expect(response.status).toBe(400);
        expect(codeOf(response)).toBe('VALIDATION_ERROR');
      }
      // Nothing was applied.
      expect(dataOf<JobDetail>(await get(workerA, `/jobs/${job.id}`)).status).toBe(
        'ASSIGNED',
      );
    });

    it('keeps the first fix when a command with a location is retried', async () => {
      const job = await assignedJob();
      const key = randomUUID();
      await post(workerA, `/jobs/${job.id}/start`, { location: fix() }).set(
        'Idempotency-Key',
        key,
      );
      const retry = await t
        .http()
        .post(`/api/v1/jobs/${job.id}/start`)
        .set(as(workerA))
        .set('Idempotency-Key', key)
        .send({ location: fix({ latitude: 28.7 }) });
      expect(retry.status).toBe(200);
      expect(dataOf<JobDetail>(retry).startLocation?.latitude).toBe(28.6149);
      expect(
        await t.prisma.jobEvent.count({
          where: { jobId: job.id, type: 'STARTED' },
        }),
      ).toBe(1);
    });
  });

  // ---- Evidence --------------------------------------------------------------------------

  describe('evidence', () => {
    const upload = (
      actor: Actor,
      jobId: string,
      file: Buffer | null,
      fields: { id?: string; capturedAt?: string } = {},
      contentType = 'image/jpeg',
    ) => {
      const request = t
        .http()
        .post(`/api/v1/jobs/${jobId}/evidence`)
        .set(as(actor))
        .field('id', fields.id ?? randomUUID())
        .field('capturedAt', fields.capturedAt ?? '2026-09-28T10:40:00+05:30');
      return file === null
        ? request
        : request.attach('file', file, { filename: 'photo.jpg', contentType });
    };

    it('stores a photo, detects its type from the bytes and strips its metadata', async () => {
      const job = await assignedJob();
      const id = randomUUID();

      // The client claims a PDF; the server believes the bytes.
      const response = await upload(workerA, job.id, jpeg(1920, 1080), { id }, 'application/pdf');

      expect(response.status).toBe(201);
      expect(dataOf<JobDetail>(response).evidence).toEqual([
        {
          id,
          contentType: 'image/jpeg',
          sizeBytes: expect.any(Number),
          width: 1920,
          height: 1080,
          uploadedBy: { id: workerA.id, firstName: 'worker-a', lastName: 'Test' },
          capturedAt: '2026-09-28T05:10:00.000Z',
          createdAt: expect.any(String),
        },
      ]);

      const content = await t
        .http()
        .get(`/api/v1/jobs/${job.id}/evidence/${id}/content`)
        .set(as(manager))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(content.status).toBe(200);
      expect(content.headers['content-type']).toBe('image/jpeg');
      const bytes = content.body as Buffer;
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(bytes.includes(Buffer.from('GPS'))).toBe(false);
    });

    it('treats a repeated upload of the same evidence as a replay', async () => {
      const job = await assignedJob();
      const id = randomUUID();
      await upload(workerA, job.id, jpeg(10, 10), { id });
      const again = await upload(workerA, job.id, jpeg(10, 10), { id });

      expect(again.status).toBe(201);
      expect(dataOf<JobDetail>(again).evidence).toHaveLength(1);
      expect(await t.prisma.jobEvidence.count()).toBe(1);
    });

    it('rejects files that are not JPEG or PNG, damaged files and missing files', async () => {
      const job = await assignedJob();
      const script = await upload(
        workerA,
        job.id,
        Buffer.from('<html><script>alert(1)</script></html>'),
        {},
        'image/jpeg',
      );
      expect(script.status).toBe(415);
      expect(codeOf(script)).toBe('UNSUPPORTED_FILE_TYPE');

      const truncated = await upload(workerA, job.id, jpeg(10, 10).subarray(0, 12));
      expect(codeOf(truncated)).toBe('UNSUPPORTED_FILE_TYPE');

      const missing = await upload(workerA, job.id, null);
      expect(missing.status).toBe(400);
      expect(codeOf(missing)).toBe('VALIDATION_ERROR');

      expect(await t.prisma.jobEvidence.count()).toBe(0);
    });

    it('rejects a file over 10 MB', async () => {
      const job = await assignedJob();
      const big = Buffer.concat([jpeg(10, 10), Buffer.alloc(10 * 1_048_576)]);
      const response = await upload(workerA, job.id, big);
      expect(response.status).toBe(413);
      expect(codeOf(response)).toBe('PAYLOAD_TOO_LARGE');
    });

    it('lets only the assigned worker upload, and only people who see the job download', async () => {
      const job = await assignedJob(workerA);
      const id = randomUUID();

      expect((await upload(workerB, job.id, jpeg(10, 10))).status).toBe(404);
      expect((await upload(manager, job.id, jpeg(10, 10))).status).toBe(403);

      await upload(workerA, job.id, jpeg(10, 10), { id });
      const path = `/jobs/${job.id}/evidence/${id}/content`;
      expect((await get(workerA, path)).status).toBe(200);
      expect((await get(workerB, path)).status).toBe(404);
      // Evidence addressed through another job is not found either.
      const other = await assignedJob(workerB);
      expect(
        (await get(manager, `/jobs/${other.id}/evidence/${id}/content`)).status,
      ).toBe(404);
    });

    it('refuses an evidence ID that belongs to other evidence', async () => {
      const first = await assignedJob(workerA);
      const second = await assignedJob(workerA);
      const id = randomUUID();
      await upload(workerA, first.id, jpeg(10, 10), { id });

      const reused = await upload(workerA, second.id, jpeg(10, 10), { id });
      expect(reused.status).toBe(422);
      expect(codeOf(reused)).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  // ---- Messages --------------------------------------------------------------------------

  describe('messages', () => {
    const message = (overrides: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      body: 'Customer wants the old unit removed. OK?',
      occurredAt: '2026-09-28T10:45:00+05:30',
      ...overrides,
    });

    it('carries a conversation between the worker and managers', async () => {
      const job = await assignedJob();

      const fromWorker = await post(workerA, `/jobs/${job.id}/messages`, message());
      expect(fromWorker.status).toBe(201);
      const reply = await post(
        manager,
        `/jobs/${job.id}/messages`,
        message({ body: 'Yes, take it.' }),
      );
      expect(reply.status).toBe(201);

      const seen = dataOf<JobDetail>(await get(workerA, `/jobs/${job.id}`));
      expect(seen.messages.map(item => [item.author.id, item.body])).toEqual([
        [workerA.id, 'Customer wants the old unit removed. OK?'],
        [manager.id, 'Yes, take it.'],
      ]);
      // In the worker's offline snapshot too.
      const set = dataOf<JobWorkingSet>(await get(workerA, '/jobs/working-set'));
      expect(set.jobs[0]?.messages).toHaveLength(2);
    });

    it("keeps other workers out of a job's conversation", async () => {
      const job = await assignedJob(workerA);
      const response = await post(workerB, `/jobs/${job.id}/messages`, message());
      expect(response.status).toBe(404);
    });

    it('treats a resent message (same ID) as a replay', async () => {
      const job = await assignedJob();
      const sent = message();
      await post(workerA, `/jobs/${job.id}/messages`, sent);
      const again = await post(workerA, `/jobs/${job.id}/messages`, sent);
      expect(again.status).toBe(201);
      expect(await t.prisma.jobMessage.count()).toBe(1);
    });

    it('rejects empty and oversized messages', async () => {
      const job = await assignedJob();
      for (const body of ['   ', 'x'.repeat(2001)]) {
        const response = await post(
          workerA,
          `/jobs/${job.id}/messages`,
          message({ body }),
        );
        expect(response.status).toBe(400);
      }
    });
  });

  // ---- Notifications and push ------------------------------------------------------------

  describe('notifications', () => {
    const register = (actor: Actor, token: string) =>
      t
        .http()
        .put('/api/v1/notifications/devices/current')
        .set(as(actor))
        .send({ token });

    const inbox = async (actor: Actor) =>
      dataOf<NotificationPage>(await get(actor, '/notifications'));

    const TOKEN_A = `token-a-${'x'.repeat(40)}`;
    const TOKEN_M = `token-m-${'x'.repeat(40)}`;

    it('notifies the worker of an assignment, in the inbox and by push', async () => {
      expect((await register(workerA, TOKEN_A)).status).toBe(204);
      const job = await assignedJob(workerA);

      await eventually(async () => {
        const page = await inbox(workerA);
        expect(page.unreadCount).toBe(1);
        expect(page.items[0]).toMatchObject({
          type: 'JOB_ASSIGNED',
          jobId: job.id,
          title: 'New job assigned',
          body: '“AC repair”',
          readAt: null,
        });
      });
      await eventually(() => {
        expect(t.push.sent).toHaveLength(1);
      });
      const [push] = t.push.sent;
      expect(push?.token).toBe(TOKEN_A);
      // Push carries IDs only, never the job's content.
      expect(push?.message.data).toEqual({
        type: 'JOB_ASSIGNED',
        jobId: job.id,
        notificationId: expect.any(String),
      });
      expect(JSON.stringify(push?.message)).not.toContain('AC repair');
      expect(JSON.stringify(push?.message)).not.toContain('Connaught');
    });

    it("notifies the job's creator when the worker completes it, even from an offline replay", async () => {
      await register(manager, TOKEN_M);
      const job = await assignedJob(workerA);
      await post(workerA, `/jobs/${job.id}/start`);
      await t
        .http()
        .post(`/api/v1/jobs/${job.id}/complete`)
        .set(as(workerA))
        .set('Idempotency-Key', randomUUID())
        .send({});

      await eventually(async () => {
        const page = await inbox(manager);
        expect(page.items.map(item => item.type)).toEqual(['JOB_COMPLETED']);
      });
      await eventually(() => {
        expect(t.push.sent.map(item => item.token)).toEqual([TOKEN_M]);
      });
    });

    it('tells both workers about a reassignment and never notifies another worker', async () => {
      const job = await assignedJob(workerA);
      await post(manager, `/jobs/${job.id}/assign`, { workerId: workerB.id });

      await eventually(async () => {
        expect((await inbox(workerA)).items.map(item => item.type)).toEqual([
          'JOB_UNASSIGNED',
          'JOB_ASSIGNED',
        ]);
        expect((await inbox(workerB)).items.map(item => item.type)).toEqual([
          'JOB_ASSIGNED',
        ]);
      });
      expect((await inbox(manager)).items).toEqual([]);
    });

    it("notifies the other side of a job's conversation", async () => {
      const job = await assignedJob(workerA);
      await post(workerA, `/jobs/${job.id}/messages`, {
        id: randomUUID(),
        body: 'Need a ladder.',
        occurredAt: '2026-09-28T10:45:00+05:30',
      });
      await eventually(async () => {
        expect((await inbox(manager)).items.map(item => item.type)).toEqual([
          'JOB_MESSAGE',
        ]);
      });
    });

    it('marks notifications read, one or all, and only the caller’s own', async () => {
      await assignedJob(workerA);
      await assignedJob(workerA);
      let page: NotificationPage | undefined;
      await eventually(async () => {
        page = await inbox(workerA);
        expect(page.unreadCount).toBe(2);
      });
      const [first] = page?.items ?? [];

      const foreign = await post(workerB, `/notifications/${first?.id}/read`);
      expect(foreign.status).toBe(404);

      expect((await post(workerA, `/notifications/${first?.id}/read`)).status).toBe(
        204,
      );
      expect((await inbox(workerA)).unreadCount).toBe(1);
      expect((await post(workerA, '/notifications/read-all')).status).toBe(204);
      const after = await inbox(workerA);
      expect(after.unreadCount).toBe(0);
      expect(after.items.every((item: AppNotification) => item.readAt !== null)).toBe(
        true,
      );
    });

    it('paginates the inbox newest first', async () => {
      for (let index = 0; index < 3; index += 1) {
        await assignedJob(workerA);
      }
      await eventually(async () => {
        expect((await inbox(workerA)).unreadCount).toBe(3);
      });
      const firstPage = dataOf<NotificationPage>(
        await get(workerA, '/notifications?limit=2'),
      );
      expect(firstPage.items).toHaveLength(2);
      const secondPage = dataOf<NotificationPage>(
        await get(workerA, `/notifications?limit=2&cursor=${firstPage.nextCursor}`),
      );
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      const ids = [...firstPage.items, ...secondPage.items].map(item => item.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('replaces a rotated token and moves a token to the session now using it', async () => {
      await register(workerA, TOKEN_A);
      await register(workerA, `${TOKEN_A}-rotated`);
      expect(
        await t.prisma.pushDevice.findMany({ select: { token: true } }),
      ).toEqual([{ token: `${TOKEN_A}-rotated` }]);

      // The same phone signed in by worker B afterwards: the token now belongs to B.
      await register(workerB, `${TOKEN_A}-rotated`);
      const devices = await t.prisma.pushDevice.findMany({
        select: { userId: true },
      });
      expect(devices).toEqual([{ userId: workerB.id }]);
    });

    it('removes a registration FCM reports as unregistered', async () => {
      await register(workerA, TOKEN_A);
      t.push.invalidTokens.add(TOKEN_A);
      await assignedJob(workerA);

      await eventually(async () => {
        expect(await t.prisma.pushDevice.count()).toBe(0);
      });
    });

    it('stops pushing to a device after sign-out', async () => {
      await register(workerA, TOKEN_A);
      expect((await post(workerA, '/auth/logout')).status).toBe(204);
      await eventually(async () => {
        expect(await t.prisma.pushDevice.count()).toBe(0);
      });
    });

    it('validates tokens and lets a device unregister itself', async () => {
      expect((await register(workerA, 'short')).status).toBe(400);
      expect((await register(workerA, `${'x'.repeat(30)} ;drop`)).status).toBe(400);
      await register(workerA, TOKEN_A);
      const removed = await t
        .http()
        .delete('/api/v1/notifications/devices/current')
        .set(as(workerA));
      expect(removed.status).toBe(204);
      expect(await t.prisma.pushDevice.count()).toBe(0);
    });
  });
});
