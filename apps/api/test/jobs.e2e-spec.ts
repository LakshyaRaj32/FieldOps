import type {
  AuthResult,
  JobDetail,
  JobPage,
  Role,
  WorkerSummary,
} from '@fieldops/types';

import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

const PASSWORD = 'correct horse battery staple';

interface Actor {
  readonly id: string;
  readonly token: string;
}

const validJob = (overrides: Record<string, unknown> = {}) => ({
  title: 'AC repair',
  description: 'Split AC in the conference room is not cooling.',
  customerName: 'ABC Ltd',
  address: '12 MG Road, Bengaluru 560001',
  location: { latitude: 12.9716, longitude: 77.5946 },
  scheduledAt: '2026-09-28T10:30:00+05:30',
  priority: 'HIGH',
  notes: 'Ask for Mr. Rao at reception.',
  checklist: ['Isolate power', 'Clean filters', 'Test cooling'],
  ...overrides,
});

describe('Jobs (e2e)', () => {
  let t: TestApp;
  let manager: Actor;
  let admin: Actor;
  let workerA: Actor;
  let workerB: Actor;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  /** Registers a user (always WORKER), then grants the role directly in the database. */
  async function signUp(name: string, role: Role): Promise<Actor> {
    const response = await t
      .http()
      .post('/api/v1/auth/register')
      .send({
        email: `${name}@example.com`,
        password: PASSWORD,
        firstName: name,
        lastName: 'Test',
      });
    expect(response.status).toBe(201);
    const { user, tokens } = (response.body as { data: AuthResult }).data;
    if (role !== 'WORKER') {
      // The API reads the role from the database on every request.
      await t.prisma.user.update({ where: { id: user.id }, data: { role } });
    }
    return { id: user.id, token: tokens.accessToken };
  }

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    manager = await signUp('manager', 'MANAGER');
    admin = await signUp('admin', 'ADMIN');
    workerA = await signUp('worker-a', 'WORKER');
    workerB = await signUp('worker-b', 'WORKER');
  });

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  function post(actor: Actor, path: string, body: object = {}) {
    return t.http().post(`/api/v1${path}`).set(as(actor)).send(body);
  }

  function get(actor: Actor, path: string) {
    return t.http().get(`/api/v1${path}`).set(as(actor));
  }

  async function createJob(
    overrides: Record<string, unknown> = {},
    by: Actor = manager,
  ): Promise<JobDetail> {
    const response = await post(by, '/jobs', validJob(overrides));
    expect(response.status).toBe(201);
    return (response.body as { data: JobDetail }).data;
  }

  async function assignedJob(
    worker: Actor = workerA,
    overrides: Record<string, unknown> = {},
  ): Promise<JobDetail> {
    const job = await createJob(overrides);
    const response = await post(manager, `/jobs/${job.id}/assign`, {
      workerId: worker.id,
    });
    expect(response.status).toBe(200);
    return (response.body as { data: JobDetail }).data;
  }

  async function startedJob(worker: Actor = workerA): Promise<JobDetail> {
    const job = await assignedJob(worker);
    const response = await post(worker, `/jobs/${job.id}/start`);
    expect(response.status).toBe(200);
    return (response.body as { data: JobDetail }).data;
  }

  const dataOf = <T>(response: { body: unknown }): T =>
    (response.body as { data: T }).data;
  const codeOf = (response: { body: unknown }): string =>
    (response.body as { error: { code: string } }).error.code;

  describe('the complete lifecycle', () => {
    it('manager creates and assigns; the worker sees, starts and completes the job', async () => {
      const created = await createJob();
      expect(created.status).toBe('PENDING');

      const assigned = await post(manager, `/jobs/${created.id}/assign`, {
        workerId: workerA.id,
      });
      expect(dataOf<JobDetail>(assigned).status).toBe('ASSIGNED');

      const myJobs = dataOf<JobPage>(await get(workerA, '/jobs'));
      expect(myJobs.items.map(job => job.id)).toEqual([created.id]);
      expect(myJobs.items[0]?.allowedActions).toEqual(['start', 'note', 'evidence', 'message']);

      const details = dataOf<JobDetail>(
        await get(workerA, `/jobs/${created.id}`),
      );
      expect(details.assignedWorker?.id).toBe(workerA.id);

      const started = await post(workerA, `/jobs/${created.id}/start`);
      expect(dataOf<JobDetail>(started)).toMatchObject({
        status: 'IN_PROGRESS',
        allowedActions: ['complete', 'note', 'evidence', 'message'],
        startedAt: expect.any(String),
      });

      const completed = await post(workerA, `/jobs/${created.id}/complete`);
      expect(dataOf<JobDetail>(completed)).toMatchObject({
        status: 'COMPLETED',
        allowedActions: ['note', 'evidence', 'message'],
        completedAt: expect.any(String),
      });

      const monitored = dataOf<JobDetail>(
        await get(manager, `/jobs/${created.id}`),
      );
      expect(monitored.status).toBe('COMPLETED');
      expect(monitored.history.map(entry => entry.type)).toEqual([
        'CREATED',
        'ASSIGNED',
        'STARTED',
        'COMPLETED',
      ]);
      expect(monitored.history[1]).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'ASSIGNED',
        actor: { id: manager.id },
        assignee: { id: workerA.id },
      });
      expect(monitored.history[3]?.actor.id).toBe(workerA.id);
      // Every change bumped the version: created 1, assigned 2, started 3, completed 4.
      expect(monitored.version).toBe(4);
    });
  });

  describe('POST /api/v1/jobs (create)', () => {
    it('lets a manager create a PENDING job with all its fields', async () => {
      const response = await post(manager, '/jobs', validJob());

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: expect.any(String),
          title: 'AC repair',
          customerName: 'ABC Ltd',
          address: '12 MG Road, Bengaluru 560001',
          location: { latitude: 12.9716, longitude: 77.5946 },
          scheduledAt: '2026-09-28T05:00:00.000Z',
          priority: 'HIGH',
          status: 'PENDING',
          assignedWorker: null,
          notes: 'Ask for Mr. Rao at reception.',
          createdBy: { id: manager.id, firstName: 'manager' },
          version: 1,
          allowedActions: ['message', 'assign', 'edit', 'cancel', 'delete'],
          history: [{ type: 'CREATED', fromStatus: null, toStatus: 'PENDING' }],
        },
      });
      const job = dataOf<JobDetail>(response);
      expect(job.checklist.map(item => [item.position, item.label])).toEqual([
        [0, 'Isolate power'],
        [1, 'Clean filters'],
        [2, 'Test cooling'],
      ]);
    });

    it('applies defaults for the optional fields', async () => {
      const response = await post(manager, '/jobs', {
        title: '  Meter reading  ',
        customerName: 'City Water',
        address: 'Sector 5',
        scheduledAt: '2026-09-28T09:00:00Z',
      });

      expect(response.status).toBe(201);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        title: 'Meter reading',
        priority: 'NORMAL',
        description: null,
        location: null,
        notes: null,
        checklist: [],
      });
    });

    it('lets an admin create jobs too', async () => {
      const response = await post(admin, '/jobs', validJob());
      expect(response.status).toBe(201);
    });

    it('forbids workers (403) and anonymous callers (401)', async () => {
      const worker = await post(workerA, '/jobs', validJob());
      expect(worker.status).toBe(403);
      expect(codeOf(worker)).toBe('FORBIDDEN');

      const anonymous = await t.http().post('/api/v1/jobs').send(validJob());
      expect(anonymous.status).toBe(401);
      expect(await t.prisma.job.count()).toBe(0);
    });

    it('reports every invalid field (400 VALIDATION_ERROR)', async () => {
      const response = await post(manager, '/jobs', {
        title: '   ',
        customerName: 'x'.repeat(201),
        scheduledAt: '2026-09-28T10:30:00',
        priority: 'SOMEDAY',
        location: { latitude: 91, longitude: 0 },
        checklist: ['ok', ''],
      });

      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
      const fields = (
        response.body as { error: { details: { field: string }[] } }
      ).error.details.map(detail => detail.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'title',
          'customerName',
          'address',
          'scheduledAt',
          'priority',
          'location.latitude',
          'checklist',
        ]),
      );
      expect(await t.prisma.job.count()).toBe(0);
    });

    it('refuses to take the status, assignee or version from the client', async () => {
      for (const field of [
        { status: 'COMPLETED' },
        { assignedWorkerId: workerA.id },
        { version: 7 },
      ]) {
        const response = await post(manager, '/jobs', validJob(field));
        expect(response.status).toBe(400);
        expect(codeOf(response)).toBe('VALIDATION_ERROR');
      }
      expect(await t.prisma.job.count()).toBe(0);
    });
  });

  describe('POST /api/v1/jobs/:id/assign', () => {
    it('assigns a worker: the job becomes ASSIGNED', async () => {
      const job = await createJob();

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: workerA.id,
      });

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        status: 'ASSIGNED',
        assignedWorker: { id: workerA.id, firstName: 'worker-a' },
        allowedActions: ['message', 'assign', 'edit', 'cancel'],
      });
    });

    it('lets an admin assign', async () => {
      const job = await createJob();
      const response = await post(admin, `/jobs/${job.id}/assign`, {
        workerId: workerA.id,
      });
      expect(response.status).toBe(200);
    });

    it('forbids a worker from assigning, even to themselves (403)', async () => {
      const job = await assignedJob(workerA);

      const response = await post(workerA, `/jobs/${job.id}/assign`, {
        workerId: workerB.id,
      });

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.assignedWorkerId).toBe(workerA.id);
    });

    it('reassigns: the previous worker loses access, the new one gains it', async () => {
      const job = await assignedJob(workerA);

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: workerB.id,
      });

      expect(dataOf<JobDetail>(response).assignedWorker?.id).toBe(workerB.id);
      expect((await get(workerA, `/jobs/${job.id}`)).status).toBe(404);
      expect((await get(workerB, `/jobs/${job.id}`)).status).toBe(200);
    });

    it('treats assigning the same worker again as a no-op', async () => {
      const job = await assignedJob(workerA);

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: workerA.id,
      });

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response).version).toBe(job.version);
      expect(await t.prisma.jobEvent.count({ where: { jobId: job.id } })).toBe(
        2,
      );
    });

    it.each([
      ['a manager', () => manager.id],
      ['an unknown user', () => '01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10'],
    ])('rejects %s as assignee (422 INVALID_ASSIGNEE)', async (_case, id) => {
      const job = await createJob();

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: id(),
      });

      expect(response.status).toBe(422);
      expect(codeOf(response)).toBe('INVALID_ASSIGNEE');
    });

    it('rejects a disabled worker as assignee', async () => {
      const job = await createJob();
      await t.prisma.user.update({
        where: { id: workerB.id },
        data: { isActive: false },
      });

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: workerB.id,
      });

      expect(codeOf(response)).toBe('INVALID_ASSIGNEE');
    });

    it('refuses to reassign a job that is already in progress (409)', async () => {
      const job = await startedJob(workerA);

      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: workerB.id,
      });

      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('INVALID_STATUS_TRANSITION');
    });

    it('validates the body', async () => {
      const job = await createJob();
      const response = await post(manager, `/jobs/${job.id}/assign`, {
        workerId: 'not-a-uuid',
      });
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
    });
  });

  describe('worker access', () => {
    it("lets worker A read their own job, with only the worker's actions", async () => {
      const job = await assignedJob(workerA);

      const response = await get(workerA, `/jobs/${job.id}`);

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        id: job.id,
        allowedActions: ['start', 'note', 'evidence', 'message'],
      });
    });

    it("hides worker B's job from worker A (404, existence not revealed)", async () => {
      const job = await assignedJob(workerB);

      const response = await get(workerA, `/jobs/${job.id}`);
      const missing = await get(
        workerA,
        '/jobs/01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10',
      );

      expect(response.status).toBe(404);
      // Indistinguishable from a job that does not exist.
      expect(response.body.error).toEqual({
        ...missing.body.error,
        requestId: expect.any(String),
      });
    });

    it('hides unassigned (PENDING) jobs from workers', async () => {
      const job = await createJob();
      expect((await get(workerA, `/jobs/${job.id}`)).status).toBe(404);
    });

    it('lists only the jobs assigned to the calling worker', async () => {
      const mine = await assignedJob(workerA);
      await assignedJob(workerB);
      await createJob();

      const page = dataOf<JobPage>(await get(workerA, '/jobs'));

      expect(page.items.map(job => job.id)).toEqual([mine.id]);
    });

    it("refuses a worker asking for another worker's list (403)", async () => {
      await assignedJob(workerB);

      const response = await get(
        workerA,
        `/jobs?assignedWorkerId=${workerB.id}`,
      );

      expect(response.status).toBe(403);
      expect(codeOf(response)).toBe('FORBIDDEN');
    });
  });

  describe('manager and admin access', () => {
    it('lists every job, filterable by status and worker', async () => {
      const pending = await createJob();
      const forA = await assignedJob(workerA);
      const forB = await assignedJob(workerB);

      const all = dataOf<JobPage>(await get(manager, '/jobs'));
      expect(all.items).toHaveLength(3);

      const pendingOnly = dataOf<JobPage>(
        await get(manager, '/jobs?status=PENDING'),
      );
      expect(pendingOnly.items.map(job => job.id)).toEqual([pending.id]);

      const assignedToB = dataOf<JobPage>(
        await get(
          admin,
          `/jobs?status=ASSIGNED,IN_PROGRESS&assignedWorkerId=${workerB.id}`,
        ),
      );
      expect(assignedToB.items.map(job => job.id)).toEqual([forB.id]);
      expect(forA.id).not.toBe(forB.id);
    });

    it('reads any job', async () => {
      const job = await assignedJob(workerA);
      expect((await get(manager, `/jobs/${job.id}`)).status).toBe(200);
      expect((await get(admin, `/jobs/${job.id}`)).status).toBe(200);
    });

    it('treats an empty status filter as no filter, and accepts repeated parameters', async () => {
      await createJob();
      await assignedJob(workerA);

      const empty = dataOf<JobPage>(await get(manager, '/jobs?status='));
      expect(empty.items).toHaveLength(2);

      const repeated = dataOf<JobPage>(
        await get(manager, '/jobs?status=PENDING&status=ASSIGNED'),
      );
      expect(repeated.items).toHaveLength(2);
    });

    it('rejects an invalid status filter and an invalid ID', async () => {
      expect(codeOf(await get(manager, '/jobs?status=DONE'))).toBe(
        'VALIDATION_ERROR',
      );
      const badId = await get(manager, '/jobs/123');
      expect(badId.status).toBe(400);
      expect(codeOf(badId)).toBe('VALIDATION_ERROR');
    });

    it('answers 404 for a job that does not exist', async () => {
      const response = await get(
        manager,
        '/jobs/01927c4e-7a52-7cc1-a3b5-3c8e1f7e2a10',
      );
      expect(response.status).toBe(404);
      expect(codeOf(response)).toBe('NOT_FOUND');
    });
  });

  describe('pagination', () => {
    it('pages by scheduled time with a cursor, without gaps or repeats', async () => {
      const late = await createJob({ scheduledAt: '2026-09-30T09:00:00Z' });
      const early = await createJob({ scheduledAt: '2026-09-28T09:00:00Z' });
      const middle = await createJob({ scheduledAt: '2026-09-29T09:00:00Z' });

      const first = dataOf<JobPage>(await get(manager, '/jobs?limit=2'));
      expect(first.items.map(job => job.id)).toEqual([early.id, middle.id]);
      expect(first.nextCursor).toEqual(expect.any(String));

      const second = dataOf<JobPage>(
        await get(manager, `/jobs?limit=2&cursor=${first.nextCursor}`),
      );
      expect(second.items.map(job => job.id)).toEqual([late.id]);
      expect(second.nextCursor).toBeNull();

      const latestFirst = dataOf<JobPage>(
        await get(manager, '/jobs?order=desc'),
      );
      expect(latestFirst.items.map(job => job.id)).toEqual([
        late.id,
        middle.id,
        early.id,
      ]);
    });

    it('rejects a forged cursor', async () => {
      const response = await get(manager, '/jobs?cursor=bm90LWEtY3Vyc29y');
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/jobs/:id/start', () => {
    it('moves ASSIGNED to IN_PROGRESS for the assigned worker', async () => {
      const job = await assignedJob(workerA);

      const response = await post(workerA, `/jobs/${job.id}/start`);

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response).status).toBe('IN_PROGRESS');
    });

    it('is safe to repeat (a retry does not fail or record twice)', async () => {
      const job = await startedJob(workerA);

      const again = await post(workerA, `/jobs/${job.id}/start`);

      expect(again.status).toBe(200);
      expect(dataOf<JobDetail>(again).version).toBe(job.version);
      expect(
        await t.prisma.jobEvent.count({
          where: { jobId: job.id, type: 'STARTED' },
        }),
      ).toBe(1);
    });

    it("does not let worker B start worker A's job (404)", async () => {
      const job = await assignedJob(workerA);

      const response = await post(workerB, `/jobs/${job.id}/start`);

      expect(response.status).toBe(404);
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe('ASSIGNED');
    });

    it('does not let managers or admins do the field work (403)', async () => {
      const job = await assignedJob(workerA);

      for (const actor of [manager, admin]) {
        const response = await post(actor, `/jobs/${job.id}/start`);
        expect(response.status).toBe(403);
        expect(codeOf(response)).toBe('FORBIDDEN');
      }
    });

    it('rejects starting a cancelled or completed job (409)', async () => {
      const cancelled = await assignedJob(workerA);
      await post(manager, `/jobs/${cancelled.id}/cancel`);

      const response = await post(workerA, `/jobs/${cancelled.id}/start`);

      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        message: "A job that is cancelled can't be started.",
      });
    });
  });

  describe('POST /api/v1/jobs/:id/complete', () => {
    it('moves IN_PROGRESS to COMPLETED', async () => {
      const job = await startedJob(workerA);

      const response = await post(workerA, `/jobs/${job.id}/complete`);

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response).status).toBe('COMPLETED');
    });

    it('rejects completing a job that was never started (409)', async () => {
      const job = await assignedJob(workerA);

      const response = await post(workerA, `/jobs/${job.id}/complete`);

      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('INVALID_STATUS_TRANSITION');
    });

    it('rejects completing a PENDING job: nobody can', async () => {
      const job = await createJob();

      // Managers never complete jobs; workers cannot even see an unassigned one.
      expect((await post(manager, `/jobs/${job.id}/complete`)).status).toBe(
        403,
      );
      expect((await post(workerA, `/jobs/${job.id}/complete`)).status).toBe(
        404,
      );
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.status).toBe('PENDING');
    });

    it("does not let another worker complete someone else's job", async () => {
      const job = await startedJob(workerA);
      const response = await post(workerB, `/jobs/${job.id}/complete`);
      expect(response.status).toBe(404);
    });

    it('keeps completed jobs closed: no restart, no cancel, no edit', async () => {
      const job = await startedJob(workerA);
      const completed = dataOf<JobDetail>(
        await post(workerA, `/jobs/${job.id}/complete`),
      );

      expect(codeOf(await post(workerA, `/jobs/${job.id}/start`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      expect(codeOf(await post(manager, `/jobs/${job.id}/cancel`))).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      const edit = await t
        .http()
        .patch(`/api/v1/jobs/${job.id}`)
        .set(as(manager))
        .send({ version: completed.version, title: 'Reopened?' });
      expect(edit.status).toBe(409);
      expect(codeOf(edit)).toBe('JOB_NOT_EDITABLE');
    });
  });

  describe('POST /api/v1/jobs/:id/cancel', () => {
    it('lets a manager cancel an in-progress job with a reason', async () => {
      const job = await startedJob(workerA);

      const response = await post(manager, `/jobs/${job.id}/cancel`, {
        reason: 'Customer rescheduled.',
      });

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Customer rescheduled.',
        cancelledAt: expect.any(String),
        allowedActions: ['message'],
      });
      // The worker still sees the job, now closed: only notes, photos and messages remain.
      const forWorker = dataOf<JobDetail>(
        await get(workerA, `/jobs/${job.id}`),
      );
      expect(forWorker.allowedActions).toEqual(['note', 'evidence', 'message']);
    });

    it('forbids workers from cancelling (403)', async () => {
      const job = await assignedJob(workerA);
      const response = await post(workerA, `/jobs/${job.id}/cancel`);
      expect(response.status).toBe(403);
    });

    it('is safe to repeat', async () => {
      const job = await createJob();
      await post(manager, `/jobs/${job.id}/cancel`);
      const again = await post(manager, `/jobs/${job.id}/cancel`);
      expect(again.status).toBe(200);
      expect(
        await t.prisma.jobEvent.count({
          where: { jobId: job.id, type: 'CANCELLED' },
        }),
      ).toBe(1);
    });
  });

  describe('PATCH /api/v1/jobs/:id', () => {
    const patch = (actor: Actor, id: string, body: object) =>
      t.http().patch(`/api/v1/jobs/${id}`).set(as(actor)).send(body);

    it('updates manager-owned fields and bumps the version', async () => {
      const job = await assignedJob(workerA);

      const response = await patch(manager, job.id, {
        version: job.version,
        title: 'AC repair (2 units)',
        description: null,
        priority: 'URGENT',
        checklist: ['Clean filters'],
      });

      expect(response.status).toBe(200);
      expect(dataOf<JobDetail>(response)).toMatchObject({
        title: 'AC repair (2 units)',
        description: null,
        priority: 'URGENT',
        customerName: 'ABC Ltd',
        status: 'ASSIGNED',
        version: job.version + 1,
        checklist: [{ position: 0, label: 'Clean filters' }],
      });
    });

    it('rejects a stale version (409 VERSION_CONFLICT)', async () => {
      const job = await createJob();
      await patch(manager, job.id, { version: job.version, title: 'First' });

      const response = await patch(admin, job.id, {
        version: job.version,
        title: 'Second',
      });

      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('VERSION_CONFLICT');
    });

    it('lets exactly one of two concurrent edits win', async () => {
      const job = await createJob();

      const results = await Promise.all([
        patch(manager, job.id, { version: job.version, title: 'Mine' }),
        patch(admin, job.id, { version: job.version, title: 'Yours' }),
      ]);

      expect(results.map(r => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const row = await t.prisma.job.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(row.version).toBe(job.version + 1);
    });

    it('never changes status through PATCH', async () => {
      const job = await createJob();
      const response = await patch(manager, job.id, {
        version: job.version,
        status: 'COMPLETED',
      });
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
    });

    it('rejects null for fields that cannot be cleared', async () => {
      const job = await createJob();
      const response = await patch(manager, job.id, {
        version: job.version,
        title: null,
      });
      expect(response.status).toBe(400);
      expect(codeOf(response)).toBe('VALIDATION_ERROR');
    });

    it('fixes the checklist once the job has started', async () => {
      const job = await startedJob(workerA);

      const response = await patch(manager, job.id, {
        version: job.version,
        checklist: ['Something else'],
      });

      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('JOB_NOT_EDITABLE');
    });

    it('forbids workers from editing, even their own job (403)', async () => {
      const job = await assignedJob(workerA);
      const response = await patch(workerA, job.id, {
        version: job.version,
        title: 'Easier job',
      });
      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/jobs/:id', () => {
    const remove = (actor: Actor, id: string) =>
      t.http().delete(`/api/v1/jobs/${id}`).set(as(actor));

    it('deletes a pending job with its checklist and history', async () => {
      const job = await createJob();

      const response = await remove(manager, job.id);

      expect(response.status).toBe(204);
      expect(await t.prisma.job.count()).toBe(0);
      expect(await t.prisma.jobChecklistItem.count()).toBe(0);
      expect(await t.prisma.jobEvent.count()).toBe(0);
    });

    it('refuses to delete a job that was ever assigned (409): cancel it instead', async () => {
      const job = await assignedJob(workerA);
      const response = await remove(manager, job.id);
      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('JOB_NOT_EDITABLE');
    });

    it('forbids workers (403)', async () => {
      const job = await createJob();
      expect((await remove(workerA, job.id)).status).toBe(403);
    });
  });

  describe('GET /api/v1/users/workers', () => {
    it('lists active workers for managers and admins, without other roles', async () => {
      await t.prisma.user.update({
        where: { id: workerB.id },
        data: { isActive: false },
      });

      for (const actor of [manager, admin]) {
        const response = await get(actor, '/users/workers');
        expect(response.status).toBe(200);
        expect(dataOf<WorkerSummary[]>(response)).toEqual([
          {
            id: workerA.id,
            firstName: 'worker-a',
            lastName: 'Test',
            email: 'worker-a@example.com',
          },
        ]);
      }
    });

    it('is not available to workers (403)', async () => {
      const response = await get(workerA, '/users/workers');
      expect(response.status).toBe(403);
    });
  });
});
