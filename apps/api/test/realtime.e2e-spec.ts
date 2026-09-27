import type {
  AuthResult,
  JobDetail,
  JobWorkingSet,
  RealtimeEnvelope,
  Role,
} from '@fieldops/types';
import { io, type Socket } from 'socket.io-client';

import {
  createTestApp,
  eventually,
  joinOrganization,
  resetDatabase,
  type TestApp,
} from './helpers/test-app.js';

type JoinRole = Parameters<typeof joinOrganization>[2];

/**
 * The realtime channel end to end: a real Socket.IO client against the listening app.
 * Covers authentication, who receives which event, sign-out, and the rule that events are
 * hints: a client that missed events converges through the ordinary snapshot (sync).
 */
describe('Realtime (e2e)', () => {
  let t: TestApp;
  let manager: Actor;
  let workerA: Actor;
  let workerB: Actor;
  const sockets: Socket[] = [];

  interface Actor {
    readonly id: string;
    readonly token: string;
  }

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
  });

  afterAll(async () => {
    await t.app.close();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
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
    // Phase 2-4 semantics: one manager runs the whole organization.
    await joinOrganization(t.prisma, user.id, role as JoinRole, undefined, {
      organizationWideAccess: role === 'MANAGER',
    });
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
  const post = (actor: Actor, path: string, body: object = {}) =>
    t.http().post(`/api/v1${path}`).set(as(actor)).send(body);

  /** A client like the app's: websocket transport, token in the handshake, no auto-retry. */
  function client(token: string | undefined): Socket {
    const socket = io(t.url ?? '', {
      path: '/realtime',
      transports: ['websocket'],
      auth: token === undefined ? {} : { token },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  }

  function refused(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => reject(new Error('connected')));
      socket.once('connect_error', error => resolve(error.message));
    });
  }

  function record(socket: Socket): RealtimeEnvelope[] {
    const received: RealtimeEnvelope[] = [];
    socket.on('event', (envelope: RealtimeEnvelope) => received.push(envelope));
    return received;
  }

  async function createJob(): Promise<JobDetail> {
    return dataOf<JobDetail>(
      await post(manager, '/jobs', {
        title: 'AC repair',
        customerName: 'ABC Ltd',
        address: '12 MG Road',
        scheduledAt: '2026-09-28T10:30:00+05:30',
      }),
    );
  }

  it('refuses connections without a valid access token', async () => {
    expect(await refused(client(undefined))).toBe('UNAUTHENTICATED');
    expect(await refused(client('not-a-jwt'))).toBe('ACCESS_TOKEN_INVALID');
  });

  it('refuses a token whose session was signed out', async () => {
    await post(workerA, '/auth/logout');
    expect(await refused(client(workerA.token))).toBe('SESSION_REVOKED');
  });

  it('delivers job events to managers and the assigned worker only', async () => {
    const managerSocket = client(manager.token);
    const workerASocket = client(workerA.token);
    const workerBSocket = client(workerB.token);
    await Promise.all(
      [managerSocket, workerASocket, workerBSocket].map(connected),
    );
    const toManager = record(managerSocket);
    const toWorkerA = record(workerASocket);
    const toWorkerB = record(workerBSocket);

    const job = await createJob();
    await post(manager, `/jobs/${job.id}/assign`, { workerId: workerA.id });
    await post(workerA, `/jobs/${job.id}/start`);

    await eventually(() => {
      expect(toWorkerA.map(event => event.data)).toEqual([
        { jobId: job.id, change: 'assigned', status: 'ASSIGNED', version: 2 },
        { jobId: job.id, change: 'started', status: 'IN_PROGRESS', version: 3 },
      ]);
      // Managers see every job's changes.
      expect(toManager.map(event => event.data)).toEqual([
        { jobId: job.id, change: 'assigned', status: 'ASSIGNED', version: 2 },
        { jobId: job.id, change: 'started', status: 'IN_PROGRESS', version: 3 },
      ]);
    });
    expect(toWorkerB).toEqual([]);
    // Envelopes are versioned and unique; they carry IDs and status, no job content.
    const [first] = toWorkerA;
    expect(first).toMatchObject({ type: 'job.changed', version: 1 });
    expect(new Set(toWorkerA.map(event => event.id)).size).toBe(2);
    expect(JSON.stringify(toWorkerA)).not.toContain('AC repair');
  });

  it('tells a worker when a job is taken away, then only the new worker hears of it', async () => {
    const job = await createJob();
    await post(manager, `/jobs/${job.id}/assign`, { workerId: workerA.id });
    const workerASocket = client(workerA.token);
    const workerBSocket = client(workerB.token);
    await Promise.all([connected(workerASocket), connected(workerBSocket)]);
    const toWorkerA = record(workerASocket);
    const toWorkerB = record(workerBSocket);

    await post(manager, `/jobs/${job.id}/assign`, { workerId: workerB.id });
    await post(manager, `/jobs/${job.id}/cancel`, { reason: 'Duplicate' });

    await eventually(() => {
      expect(toWorkerA.map(event => event.data)).toEqual([
        { jobId: job.id, change: 'unassigned' },
      ]);
      expect(toWorkerB.map(event => event.data.jobId)).toEqual([
        job.id,
        job.id,
      ]);
    });
  });

  it('delivers message events to the conversation', async () => {
    const job = await createJob();
    await post(manager, `/jobs/${job.id}/assign`, { workerId: workerA.id });
    const workerASocket = client(workerA.token);
    await connected(workerASocket);
    const toWorkerA = record(workerASocket);

    const response = await post(manager, `/jobs/${job.id}/messages`, {
      id: '0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a60',
      body: 'Bring a ladder.',
      occurredAt: '2026-09-28T10:45:00+05:30',
    });
    expect(response.status).toBe(201);

    await eventually(() => {
      expect(toWorkerA).toEqual([
        expect.objectContaining({
          type: 'job.message.created',
          data: {
            jobId: job.id,
            messageId: '0190c3b1-7a2e-7cc1-9f00-3b1d2e4f5a60',
          },
        }),
      ]);
    });
  });

  it('closes the connection when its session signs out', async () => {
    const socket = client(workerA.token);
    await connected(socket);
    const closed = new Promise<string>(resolve =>
      socket.once('disconnect', reason => resolve(reason)),
    );

    await post(workerA, '/auth/logout');

    expect(await closed).toBe('io server disconnect');
  });

  it('recovers missed events through sync: a reconnecting worker converges from the snapshot', async () => {
    // The worker is offline (no socket) while the manager assigns two jobs.
    const first = await createJob();
    const second = await createJob();
    await post(manager, `/jobs/${first.id}/assign`, { workerId: workerA.id });
    await post(manager, `/jobs/${second.id}/assign`, { workerId: workerA.id });

    // Reconnecting does not replay those events: realtime is not the source of truth.
    const socket = client(workerA.token);
    await connected(socket);
    const replayed = record(socket);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(replayed).toEqual([]);

    // What the app does on (re)connect: run a sync, which downloads the working set.
    const set = dataOf<JobWorkingSet>(
      await t.http().get('/api/v1/jobs/working-set').set(as(workerA)),
    );
    expect(set.jobs.map(job => job.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });
});
