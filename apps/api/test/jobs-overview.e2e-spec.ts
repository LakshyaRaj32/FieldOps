import type { AuthResult, JobDetail, JobOverview, Role } from '@fieldops/types';

import {
  createTestApp,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

const PASSWORD = 'correct horse battery staple';
const HOUR = 3_600_000;

interface Actor {
  readonly id: string;
  readonly token: string;
}

describe('GET /api/v1/jobs/overview (e2e)', () => {
  let t: TestApp;
  let manager: Actor;
  let admin: Actor;
  let asha: Actor;
  let ravi: Actor;

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
        email: `${name.toLowerCase()}@example.com`,
        password: PASSWORD,
        firstName: name,
        lastName: 'Test',
      });
    expect(response.status).toBe(201);
    const { user, tokens } = (response.body as { data: AuthResult }).data;
    if (role !== 'WORKER') {
      await t.prisma.user.update({ where: { id: user.id }, data: { role } });
    }
    return { id: user.id, token: tokens.accessToken };
  }

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    manager = await signUp('Manager', 'MANAGER');
    admin = await signUp('Admin', 'ADMIN');
    asha = await signUp('Asha', 'WORKER');
    ravi = await signUp('Ravi', 'WORKER');
  });

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  function post(actor: Actor, path: string, body: object = {}) {
    return t.http().post(`/api/v1${path}`).set(as(actor)).send(body);
  }

  const overview = (actor: Actor) =>
    t.http().get('/api/v1/jobs/overview').set(as(actor));

  async function createJob(title: string, scheduledAt: Date): Promise<string> {
    const response = await post(manager, '/jobs', {
      title,
      customerName: 'ABC Ltd',
      address: '12 MG Road, Bengaluru 560001',
      scheduledAt: scheduledAt.toISOString(),
      priority: 'NORMAL',
    });
    expect(response.status).toBe(201);
    return (response.body as { data: JobDetail }).data.id;
  }

  async function assign(jobId: string, worker: Actor): Promise<void> {
    const response = await post(manager, `/jobs/${jobId}/assign`, {
      workerId: worker.id,
    });
    expect(response.status).toBe(200);
  }

  async function transition(
    jobId: string,
    worker: Actor,
    action: 'start' | 'complete',
  ): Promise<void> {
    const response = await post(worker, `/jobs/${jobId}/${action}`);
    expect(response.status).toBe(200);
  }

  it('is for managers and admins only', async () => {
    expect((await overview(asha)).status).toBe(403);
    expect((await t.http().get('/api/v1/jobs/overview')).status).toBe(401);
    expect((await overview(manager)).status).toBe(200);
    expect((await overview(admin)).status).toBe(200);
  });

  it('reports zeros, not missing fields, when there are no jobs', async () => {
    const response = await overview(manager);
    const data = (response.body as { data: JobOverview }).data;

    expect(data).toMatchObject({
      statusCounts: {
        PENDING: 0,
        ASSIGNED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      overdue: 0,
      dueNext24Hours: 0,
      completedLast7Days: 0,
      cancelledLast7Days: 0,
      workload: [],
      recentActivity: [],
    });
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
  });

  it('counts every job and lists workload and recent activity from real data', async () => {
    const now = Date.now();
    // Unassigned and already late.
    const late = await createJob('Late pump check', new Date(now - 2 * HOUR));
    // Asha: one due soon, one in progress, one completed.
    const soon = await createJob('Boiler service', new Date(now + 3 * HOUR));
    await assign(soon, asha);
    const busy = await createJob('Meter reading', new Date(now + 48 * HOUR));
    await assign(busy, asha);
    await transition(busy, asha, 'start');
    const done = await createJob('AC repair', new Date(now - HOUR));
    await assign(done, asha);
    await transition(done, asha, 'start');
    await transition(done, asha, 'complete');
    // Ravi: one assigned; then a cancelled job.
    const ravisJob = await createJob(
      'Filter change',
      new Date(now + 30 * HOUR),
    );
    await assign(ravisJob, ravi);
    const dropped = await createJob('Duplicate visit', new Date(now + HOUR));
    const cancelled = await post(manager, `/jobs/${dropped}/cancel`, {});
    expect(cancelled.status).toBe(200);

    const data = ((await overview(manager)).body as { data: JobOverview }).data;

    expect(data.statusCounts).toEqual({
      PENDING: 1,
      ASSIGNED: 2,
      IN_PROGRESS: 1,
      COMPLETED: 1,
      CANCELLED: 1,
    });
    // Only open jobs count as overdue: the completed job was also scheduled in the past.
    expect(data.overdue).toBe(1);
    expect(data.dueNext24Hours).toBe(1);
    expect(data.completedLast7Days).toBe(1);
    expect(data.cancelledLast7Days).toBe(1);

    expect(
      data.workload.map(entry => [
        entry.worker.firstName,
        entry.assigned,
        entry.inProgress,
      ]),
    ).toEqual([
      ['Asha', 1, 1],
      ['Ravi', 1, 0],
    ]);

    // Newest first, capped at 10, each entry naming its job.
    expect(data.recentActivity).toHaveLength(10);
    expect(data.recentActivity[0]).toMatchObject({
      jobId: dropped,
      jobTitle: 'Duplicate visit',
      type: 'CANCELLED',
      toStatus: 'CANCELLED',
      actor: { id: manager.id },
    });
    const times = data.recentActivity.map(entry => Date.parse(entry.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(data.recentActivity.some(entry => entry.jobId === late)).toBe(false);
  });
});
