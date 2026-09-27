import { randomUUID } from 'node:crypto';

import type {
  AuthResult,
  JobDetail,
  JobWorkingSet,
  Role,
} from '@fieldops/types';

import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

/**
 * The server side of offline work (Phase 3): what a worker's device downloads, and how the
 * server treats the commands the device replays after being offline. Requests here are exactly
 * what the mobile sync engine sends: domain commands with an Idempotency-Key per command,
 * repeated unchanged on every retry.
 */
describe('Offline sync (e2e)', () => {
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
    manager = await signUp('manager', 'MANAGER');
    workerA = await signUp('worker-a', 'WORKER');
    workerB = await signUp('worker-b', 'WORKER');
  });

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
  const dataOf = <T>(response: { body: unknown }): T =>
    (response.body as { data: T }).data;
  const codeOf = (response: { body: unknown }): string =>
    (response.body as { error: { code: string } }).error.code;

  /** A device command: POST with an Idempotency-Key, as the sync engine sends it. */
  function command(actor: Actor, path: string, key: string, body: object = {}) {
    return t
      .http()
      .post(`/api/v1${path}`)
      .set(as(actor))
      .set('Idempotency-Key', key)
      .send(body);
  }

  const note = (overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    body: 'Compressor replaced.',
    occurredAt: '2026-09-27T10:42:00+05:30',
    ...overrides,
  });

  async function assignedJob(
    worker: Actor = workerA,
    overrides: Record<string, unknown> = {},
  ): Promise<JobDetail> {
    const created = await t
      .http()
      .post('/api/v1/jobs')
      .set(as(manager))
      .send({
        title: 'AC repair',
        customerName: 'ABC Ltd',
        address: '12 MG Road',
        scheduledAt: '2026-09-28T10:30:00+05:30',
        checklist: ['Clean filters'],
        ...overrides,
      });
    const job = dataOf<JobDetail>(created);
    const assigned = await t
      .http()
      .post(`/api/v1/jobs/${job.id}/assign`)
      .set(as(manager))
      .send({ workerId: worker.id });
    return dataOf<JobDetail>(assigned);
  }

  const eventsOf = (jobId: string, type?: string) =>
    t.prisma.jobEvent.count({
      where: { jobId, ...(type !== undefined && { type: type as never }) },
    });

  describe('GET /api/v1/jobs/working-set', () => {
    it("returns the worker's open jobs with everything needed offline", async () => {
      const mine = await assignedJob(workerA);
      await assignedJob(workerB);

      const response = await t
        .http()
        .get('/api/v1/jobs/working-set')
        .set(as(workerA));

      expect(response.status).toBe(200);
      const set = dataOf<JobWorkingSet>(response);
      expect(set.generatedAt).toEqual(expect.any(String));
      expect(set.jobs.map(job => job.id)).toEqual([mine.id]);
      expect(set.jobs[0]).toMatchObject({
        status: 'ASSIGNED',
        checklist: [{ label: 'Clean filters' }],
        fieldNotes: [],
        history: [{ type: 'CREATED' }, { type: 'ASSIGNED' }],
        allowedActions: ['start', 'note', 'evidence', 'message'],
      });
    });

    it('keeps recently closed jobs and drops old ones', async () => {
      const recent = await assignedJob(workerA);
      const old = await assignedJob(workerA);
      for (const job of [recent, old]) {
        await t.http().post(`/api/v1/jobs/${job.id}/cancel`).set(as(manager));
      }
      await t.prisma
        .$executeRaw`UPDATE jobs SET updated_at = now() - interval '8 days' WHERE id = ${old.id}::uuid`;

      const set = dataOf<JobWorkingSet>(
        await t.http().get('/api/v1/jobs/working-set').set(as(workerA)),
      );

      expect(set.jobs.map(job => job.id)).toEqual([recent.id]);
    });

    it('is for workers only', async () => {
      const response = await t
        .http()
        .get('/api/v1/jobs/working-set')
        .set(as(manager));
      expect(response.status).toBe(403);
    });
  });

  describe('idempotent commands (Idempotency-Key)', () => {
    it('applies a retried start once, and answers the retry with the job', async () => {
      const job = await assignedJob();
      const key = randomUUID();

      const first = await command(workerA, `/jobs/${job.id}/start`, key);
      // The response was "lost": the device retries with the same key.
      const retry = await command(workerA, `/jobs/${job.id}/start`, key);

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(dataOf<JobDetail>(retry).status).toBe('IN_PROGRESS');
      expect(dataOf<JobDetail>(retry).version).toBe(
        dataOf<JobDetail>(first).version,
      );
      expect(await eventsOf(job.id, 'STARTED')).toBe(1);
      expect(await t.prisma.processedMutation.count()).toBe(1);
    });

    it('applies two simultaneous deliveries of the same command once', async () => {
      const job = await assignedJob();
      const key = randomUUID();

      const results = await Promise.all([
        command(workerA, `/jobs/${job.id}/start`, key),
        command(workerA, `/jobs/${job.id}/start`, key),
      ]);

      expect(results.map(r => r.status)).toEqual([200, 200]);
      expect(await eventsOf(job.id, 'STARTED')).toBe(1);
      expect(await t.prisma.processedMutation.count()).toBe(1);
    });

    it('replays a command even after the job has moved on', async () => {
      const job = await assignedJob();
      const startKey = randomUUID();
      await command(workerA, `/jobs/${job.id}/start`, startKey);
      await command(workerA, `/jobs/${job.id}/complete`, randomUUID());

      // A late retry of "start": without idempotency it would be a 409 (COMPLETED → start).
      const late = await command(workerA, `/jobs/${job.id}/start`, startKey);

      expect(late.status).toBe(200);
      expect(dataOf<JobDetail>(late).status).toBe('COMPLETED');
    });

    it('refuses a key reused for another command or another job (422)', async () => {
      const job = await assignedJob();
      const other = await assignedJob();
      const key = randomUUID();
      await command(workerA, `/jobs/${job.id}/start`, key);

      const otherCommand = await command(
        workerA,
        `/jobs/${job.id}/complete`,
        key,
      );
      const otherJob = await command(workerA, `/jobs/${other.id}/start`, key);

      expect(otherCommand.status).toBe(422);
      expect(codeOf(otherCommand)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(codeOf(otherJob)).toBe('IDEMPOTENCY_KEY_REUSED');
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: other.id },
      });
      expect(row.status).toBe('ASSIGNED');
    });

    it('scopes keys per user', async () => {
      const jobA = await assignedJob(workerA);
      const jobB = await assignedJob(workerB);
      const key = randomUUID();

      await command(workerA, `/jobs/${jobA.id}/start`, key);
      const response = await command(workerB, `/jobs/${jobB.id}/start`, key);

      expect(response.status).toBe(200);
      expect(await eventsOf(jobB.id, 'STARTED')).toBe(1);
    });

    it('records nothing for a rejected command, so a rejection is never replayed as success', async () => {
      const job = await assignedJob();
      await t.http().post(`/api/v1/jobs/${job.id}/cancel`).set(as(manager));
      const key = randomUUID();

      const first = await command(workerA, `/jobs/${job.id}/start`, key);
      const retry = await command(workerA, `/jobs/${job.id}/start`, key);

      expect([first.status, retry.status]).toEqual([409, 409]);
      expect(await t.prisma.processedMutation.count()).toBe(0);
    });

    it('rejects a malformed key instead of ignoring it', async () => {
      const job = await assignedJob();

      const response = await command(
        workerA,
        `/jobs/${job.id}/start`,
        'not-a-uuid',
      );

      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
      expect(await eventsOf(job.id, 'STARTED')).toBe(0);
    });
  });

  describe('POST /api/v1/jobs/:id/notes', () => {
    it('appends a field note without changing the job version', async () => {
      const job = await assignedJob();
      const payload = note();

      const response = await command(
        workerA,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        payload,
      );

      expect(response.status).toBe(201);
      const updated = dataOf<JobDetail>(response);
      expect(updated.fieldNotes).toEqual([
        {
          id: payload.id,
          body: 'Compressor replaced.',
          author: { id: workerA.id, firstName: 'worker-a', lastName: 'Test' },
          occurredAt: '2026-09-27T05:12:00.000Z',
          createdAt: expect.any(String),
        },
      ]);
      // Notes never conflict with a manager's edit of the job.
      expect(updated.version).toBe(job.version);
    });

    it('stores a note sent twice once, with or without an idempotency key', async () => {
      const job = await assignedJob();
      const payload = note();
      const key = randomUUID();

      await command(workerA, `/jobs/${job.id}/notes`, key, payload);
      await command(workerA, `/jobs/${job.id}/notes`, key, payload);
      const noKey = await t
        .http()
        .post(`/api/v1/jobs/${job.id}/notes`)
        .set(as(workerA))
        .send(payload);

      expect(noKey.status).toBe(201);
      expect(await t.prisma.jobNote.count()).toBe(1);
    });

    it('refuses a note ID already used for a different job', async () => {
      const job = await assignedJob();
      const other = await assignedJob();
      const payload = note();
      await command(workerA, `/jobs/${job.id}/notes`, randomUUID(), payload);

      const response = await command(
        workerA,
        `/jobs/${other.id}/notes`,
        randomUUID(),
        payload,
      );

      expect(response.status).toBe(422);
      expect(codeOf(response)).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('accepts notes on a closed job: field evidence is always kept', async () => {
      const job = await assignedJob();
      await t.http().post(`/api/v1/jobs/${job.id}/cancel`).set(as(manager));

      const response = await command(
        workerA,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        note(),
      );

      expect(response.status).toBe(201);
    });

    it('lets only the assigned worker add notes', async () => {
      const job = await assignedJob(workerA);

      const otherWorker = await command(
        workerB,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        note(),
      );
      const byManager = await command(
        manager,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        note(),
      );

      expect(otherWorker.status).toBe(404);
      expect(byManager.status).toBe(403);
      expect(await t.prisma.jobNote.count()).toBe(0);
    });

    it('validates the note', async () => {
      const job = await assignedJob();
      const response = await command(
        workerA,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        note({ body: '  ', occurredAt: '2026-09-27T10:42:00', id: 'x' }),
      );
      expect(response.status).toBe(400);
      const fields = (
        response.body as { error: { details: { field: string }[] } }
      ).error.details.map(detail => detail.field);
      expect(fields).toEqual(
        expect.arrayContaining(['id', 'body', 'occurredAt']),
      );
    });
  });

  describe('conflicts: commands replayed after the server state changed', () => {
    it('rejects an offline start of a job the manager cancelled, and keeps it cancelled', async () => {
      const job = await assignedJob();
      // While the worker is offline:
      await t.http().post(`/api/v1/jobs/${job.id}/cancel`).set(as(manager));

      const response = await command(
        workerA,
        `/jobs/${job.id}/start`,
        randomUUID(),
      );

      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('INVALID_STATUS_TRANSITION');
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe('CANCELLED');
    });

    it('keeps notes captured offline even when the completion conflicts', async () => {
      const job = await assignedJob();
      await command(workerA, `/jobs/${job.id}/start`, randomUUID());
      // The manager cancels while the worker, offline, adds a note and completes.
      await t.http().post(`/api/v1/jobs/${job.id}/cancel`).set(as(manager));

      const noteResult = await command(
        workerA,
        `/jobs/${job.id}/notes`,
        randomUUID(),
        note(),
      );
      const completeResult = await command(
        workerA,
        `/jobs/${job.id}/complete`,
        randomUUID(),
      );

      expect(noteResult.status).toBe(201);
      expect(completeResult.status).toBe(409);
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe('CANCELLED');
      expect(await t.prisma.jobNote.count({ where: { jobId: job.id } })).toBe(
        1,
      );
    });

    it('rejects commands on a job reassigned while the worker was offline', async () => {
      const job = await assignedJob(workerA);
      await t
        .http()
        .post(`/api/v1/jobs/${job.id}/assign`)
        .set(as(manager))
        .send({ workerId: workerB.id });

      const response = await command(
        workerA,
        `/jobs/${job.id}/start`,
        randomUUID(),
      );

      expect(response.status).toBe(404);
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row).toMatchObject({
        status: 'ASSIGNED',
        assignedWorkerId: workerB.id,
      });
    });

    it('applies a valid transition although a manager edited the job meanwhile', async () => {
      const job = await assignedJob();
      await t
        .http()
        .patch(`/api/v1/jobs/${job.id}`)
        .set(as(manager))
        .send({ version: job.version, notes: 'Gate code 4411' });

      // The device saw an older version; the state machine, not the version, decides.
      const response = await command(
        workerA,
        `/jobs/${job.id}/start`,
        randomUUID(),
      );

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        status: 'IN_PROGRESS',
        notes: 'Gate code 4411',
      });
    });
  });

  it('converges after a whole offline session is replayed, including lost responses', async () => {
    const job = await assignedJob();

    // Online: the device downloads its working set.
    const downloaded = dataOf<JobWorkingSet>(
      await t.http().get('/api/v1/jobs/working-set').set(as(workerA)),
    );
    expect(downloaded.jobs.map(j => j.status)).toEqual(['ASSIGNED']);

    // Offline: the worker starts, writes a note and completes. The outbox holds, in order:
    const fieldNote = note();
    const outbox = [
      { path: `/jobs/${job.id}/start`, key: randomUUID(), body: {} },
      { path: `/jobs/${job.id}/notes`, key: randomUUID(), body: fieldNote },
      { path: `/jobs/${job.id}/complete`, key: randomUUID(), body: {} },
    ];

    // Back online: the first sync attempt delivers everything but every response is lost,
    // so the next attempt sends the whole outbox again, unchanged.
    for (const attempt of [1, 2]) {
      for (const entry of outbox) {
        const response = await command(
          workerA,
          entry.path,
          entry.key,
          entry.body,
        );
        expect([attempt, response.status]).toEqual([
          attempt,
          entry.path.endsWith('/notes') ? 201 : 200,
        ]);
      }
    }

    // One logical mutation each, applied in order.
    const history = await t.prisma.jobEvent.findMany({
      where: { jobId: job.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(history.map(event => event.type)).toEqual([
      'CREATED',
      'ASSIGNED',
      'STARTED',
      'COMPLETED',
    ]);
    expect(await t.prisma.jobNote.count()).toBe(1);
    expect(await t.prisma.processedMutation.count()).toBe(3);

    // The next download matches what the device predicted.
    const after = dataOf<JobWorkingSet>(
      await t.http().get('/api/v1/jobs/working-set').set(as(workerA)),
    );
    expect(after.jobs[0]).toMatchObject({
      id: job.id,
      status: 'COMPLETED',
      fieldNotes: [{ id: fieldNote.id }],
      allowedActions: ['note', 'evidence', 'message'],
    });
  });
});
