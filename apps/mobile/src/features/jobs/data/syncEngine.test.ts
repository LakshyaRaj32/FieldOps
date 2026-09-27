/**
 * @jest-environment node
 */
import {
  FakeJobServer,
  serverJob,
  WORKER,
} from '../../../testing/fakeJobServer';
import {
  openStore,
  removeDatabaseFile,
  tempDatabasePath,
  testClock,
} from '../../../testing/localDb';
import type { LocalJobStore } from './localJobStore';
import { RETRY_POLICY } from './retryPolicy';
import { JobSyncEngine, type Timers } from './syncEngine';

/** Timers that never fire on their own: tests drive every cycle explicitly. */
const manualTimers = (): Timers & { scheduled: number[] } => {
  const scheduled: number[] = [];
  return {
    scheduled,
    set: (_callback, delayMs) => {
      scheduled.push(delayMs);
      return scheduled.length;
    },
    clear: () => undefined,
  };
};

async function setup(
  jobs = [serverJob()],
  options: { file?: string; server?: FakeJobServer } = {},
) {
  const clock = testClock();
  const server = options.server ?? new FakeJobServer(jobs);
  const { db, store } = await openStore(clock, options.file);
  const timers = manualTimers();
  const engine = new JobSyncEngine({
    store,
    transport: server,
    now: clock.now,
    random: () => 0.5,
    timers,
  });
  return { clock, server, db, store, engine, timers };
}

/** Download the working set once, as the app does after sign-in. */
async function downloaded(context: Awaited<ReturnType<typeof setup>>) {
  await context.engine.sync();
  return context;
}

const statusOf = async (store: LocalJobStore, id = 'job-1') =>
  (await store.getJob(id))?.job.status;

const operations = (server: FakeJobServer) =>
  server.calls.filter(call => call.operation !== 'pull').map(c => c.operation);

describe('JobSyncEngine', () => {
  it('downloads the working set into SQLite', async () => {
    const { store, engine } = await setup();

    const status = await engine.sync();

    expect(status).toMatchObject({ phase: 'idle', pending: 0 });
    expect(status.lastSyncedAt).not.toBeNull();
    expect(await statusOf(store)).toBe('ASSIGNED');
  });

  it('sends a local command, then stores the server state and marks it synced', async () => {
    const { store, engine, server } = await downloaded(await setup());
    const entry = await store.startJob('job-1');

    const status = await engine.sync();

    expect(server.jobs.get('job-1')?.status).toBe('IN_PROGRESS');
    expect(server.calls[1]).toEqual({
      operation: 'job.start',
      jobId: 'job-1',
      mutationId: entry.mutationId,
      // No position was captured: the command goes without one.
      body: {},
    });
    expect((await store.entry(entry.seq))?.status).toBe('synced');
    expect(await store.getJob('job-1')).toMatchObject({
      job: { status: 'IN_PROGRESS', version: 3 },
      pendingChanges: 0,
    });
    expect(status.pending).toBe(0);
  });

  it('sends commands for a job in the order they were made', async () => {
    const { store, engine, server } = await downloaded(await setup());
    await store.startJob('job-1');
    await store.addNote('job-1', 'Filter replaced');
    await store.completeJob('job-1');

    await engine.sync();

    expect(operations(server)).toEqual([
      'job.start',
      'job.note.add',
      'job.complete',
    ]);
    expect(server.jobs.get('job-1')?.status).toBe('COMPLETED');
  });

  describe('while offline', () => {
    it('keeps commands pending without counting attempts, and syncs when back online', async () => {
      const context = await downloaded(await setup());
      const { store, engine, server } = context;
      server.online = false;
      const entry = await store.startJob('job-1');

      const offline = await engine.sync();

      expect(offline.phase).toBe('offline');
      expect(await store.entry(entry.seq)).toMatchObject({
        status: 'pending',
        attempts: 0,
      });
      expect(await statusOf(store)).toBe('IN_PROGRESS'); // the worker keeps working
      // Only the first command was tried; the download was not attempted.
      expect(server.calls.slice(1).map(call => call.operation)).toEqual([
        'job.start',
      ]);
      expect(context.timers.scheduled.length).toBeGreaterThan(0);

      server.online = true;
      const back = await engine.sync();

      expect(back.phase).toBe('idle');
      expect(server.jobs.get('job-1')?.status).toBe('IN_PROGRESS');
      expect(server.effects).toBe(1);
    });
  });

  describe('retries', () => {
    it('backs off after a temporary server failure, then succeeds with the same mutation ID', async () => {
      const { store, engine, server, clock } = await downloaded(await setup());
      const entry = await store.startJob('job-1');
      server.faults.push({
        type: 'http',
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });

      await engine.sync();

      const waiting = await store.entry(entry.seq);
      expect(waiting).toMatchObject({
        status: 'pending',
        attempts: 1,
        lastError: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(waiting?.nextAttemptAt).not.toBeNull();

      // Not due yet: nothing is sent.
      await engine.sync();
      expect(operations(server)).toEqual(['job.start']);

      clock.advance(RETRY_POLICY.baseDelayMs);
      await engine.sync();

      expect(operations(server)).toEqual(['job.start', 'job.start']);
      const ids = server.calls
        .filter(call => call.operation === 'job.start')
        .map(call => call.mutationId);
      expect(new Set(ids)).toEqual(new Set([entry.mutationId]));
      expect((await store.entry(entry.seq))?.status).toBe('synced');
    });

    it('holds back later commands for the same job while one waits for a retry', async () => {
      const { store, engine, server } = await downloaded(
        await setup([serverJob(), serverJob({ id: 'job-2' })]),
      );
      await store.startJob('job-1');
      await store.completeJob('job-1');
      await store.startJob('job-2');
      server.faults.push({ type: 'http', status: 500, code: 'INTERNAL_ERROR' });

      await engine.sync();

      // job-1's completion never overtakes its start; job-2 is not held up.
      expect(operations(server)).toEqual(['job.start', 'job.start']);
      expect(server.calls[1]?.jobId).toBe('job-1');
      expect(server.jobs.get('job-1')?.status).toBe('ASSIGNED');
      expect(server.jobs.get('job-2')?.status).toBe('IN_PROGRESS');
    });

    it('moves a command that keeps failing to failed, and stops retrying it', async () => {
      const { store, engine, server, clock } = await downloaded(await setup());
      const entry = await store.startJob('job-1');
      server.commandFailure = { status: 503, code: 'SERVICE_UNAVAILABLE' };

      for (let i = 0; i < RETRY_POLICY.maxAttempts + 3; i += 1) {
        await engine.sync();
        clock.advance(RETRY_POLICY.maxDelayMs);
      }

      expect(await store.entry(entry.seq)).toMatchObject({
        status: 'failed',
        attempts: RETRY_POLICY.maxAttempts,
      });
      expect(operations(server)).toHaveLength(RETRY_POLICY.maxAttempts);
      // The local view falls back to the server state; the worker is told.
      expect(await statusOf(store)).toBe('ASSIGNED');
      expect((await store.counts()).failed).toBe(1);
    });

    it('isolates a permanently rejected command and syncs the rest', async () => {
      const { store, engine, server } = await downloaded(
        await setup([serverJob(), serverJob({ id: 'job-2' })]),
      );
      const bad = await store.startJob('job-1');
      await store.startJob('job-2');
      server.faults.push({
        type: 'http',
        status: 400,
        code: 'VALIDATION_ERROR',
      });

      await engine.sync();
      await engine.sync();

      expect((await store.entry(bad.seq))?.status).toBe('failed');
      expect(operations(server)).toEqual(['job.start', 'job.start']);
      expect(server.jobs.get('job-2')?.status).toBe('IN_PROGRESS');
    });
  });

  describe('duplicates', () => {
    it('applies a command once when its response is lost and it is sent again', async () => {
      const { store, engine, server } = await downloaded(await setup());
      const entry = await store.startJob('job-1');
      server.faults.push({ type: 'lostResponse' });

      await engine.sync(); // applied on the server; the device saw a network error
      expect((await store.entry(entry.seq))?.status).toBe('pending');

      await engine.sync(); // same mutation ID again: a replay

      expect(server.effects).toBe(1);
      expect(server.jobs.get('job-1')?.status).toBe('IN_PROGRESS');
      expect((await store.entry(entry.seq))?.status).toBe('synced');
    });

    it('recovers a command left in flight by a killed app and sends it again', async () => {
      const file = tempDatabasePath();
      try {
        const first = await setup([serverJob()], { file });
        await downloaded(first);
        const entry = await first.store.startJob('job-1');
        await first.store.markInFlight(entry.seq); // killed while sending
        first.db.close();

        const second = await setup([], { file, server: first.server });
        await second.engine.sync();

        expect((await second.store.entry(entry.seq))?.status).toBe('synced');
        expect(first.server.effects).toBe(1);
        second.db.close();
      } finally {
        removeDatabaseFile(file);
      }
    });

    it('runs one cycle at a time; overlapping requests coalesce', async () => {
      const { store, engine, server } = await downloaded(await setup());
      await store.startJob('job-1');

      await Promise.all([engine.sync(), engine.sync(), engine.sync()]);

      expect(operations(server)).toEqual(['job.start']);
    });
  });

  describe('conflicts', () => {
    it('lets the server win when the job was cancelled while the worker was offline', async () => {
      const { store, engine, server } = await downloaded(await setup());
      server.online = false;
      const start = await store.startJob('job-1');
      const note = await store.addNote('job-1', 'Customer not home');
      const complete = await store.completeJob('job-1');
      server.cancel('job-1'); // the manager, meanwhile

      server.online = true;
      const status = await engine.sync();

      expect(await store.entry(start.seq)).toMatchObject({
        status: 'conflict',
        lastError: { code: 'INVALID_STATUS_TRANSITION' },
      });
      expect((await store.entry(complete.seq))?.status).toBe('conflict');
      // The note is field evidence: the server keeps it.
      expect((await store.entry(note.seq))?.status).toBe('synced');
      expect(server.jobs.get('job-1')).toMatchObject({
        status: 'CANCELLED',
        fieldNotes: [expect.objectContaining({ body: 'Customer not home' })],
      });
      // The device converges to the server state and reports the conflicts.
      expect(await store.getJob('job-1')).toMatchObject({
        job: { status: 'CANCELLED' },
        pendingChanges: 0,
        problems: 2,
      });
      expect(status.conflicts).toBe(2);
    });

    it('drops a job reassigned to someone else, keeping the conflict visible', async () => {
      const { store, engine, server } = await downloaded(await setup());
      const start = await store.startJob('job-1');
      server.reassign('job-1', {
        id: 'worker-2',
        firstName: 'B',
        lastName: 'W',
      });

      await engine.sync();

      expect((await store.entry(start.seq))?.status).toBe('conflict');
      expect(await store.getJob('job-1')).toBeNull();
      expect(await store.problemEntries()).toEqual([
        expect.objectContaining({ jobTitle: 'AC repair', status: 'conflict' }),
      ]);
    });

    it('applies a valid command although the manager changed the job meanwhile', async () => {
      const { store, engine, server } = await downloaded(await setup());
      await store.startJob('job-1');
      server.editTitle('job-1', 'AC repair (2 units)');

      await engine.sync();

      expect(await store.getJob('job-1')).toMatchObject({
        job: { status: 'IN_PROGRESS', title: 'AC repair (2 units)' },
        problems: 0,
      });
    });

    it('removes a dismissed conflict from the attention list', async () => {
      const { store, engine, server } = await downloaded(await setup());
      const start = await store.startJob('job-1');
      server.cancel('job-1');
      await engine.sync();

      await store.dismiss(start.seq);

      expect(await store.problemEntries()).toEqual([]);
      expect(engine.status().conflicts).toBe(0);
    });
  });

  it('survives the whole offline session across an app restart, then converges', async () => {
    const file = tempDatabasePath();
    const server = new FakeJobServer([serverJob()]);
    const opened: { close(): void }[] = [];
    try {
      // 1. Online: sign in and download the assigned job.
      const online = await setup([], { file, server });
      opened.push(online.db);
      await online.engine.sync();
      expect(await statusOf(online.store)).toBe('ASSIGNED');

      // 2. The connection drops. The worker starts, writes a note and completes.
      server.online = false;
      await online.store.startJob('job-1');
      await online.store.addNote('job-1', 'Compressor replaced');
      await online.store.completeJob('job-1');
      await online.engine.sync(); // tries, fails, keeps everything
      expect(await statusOf(online.store)).toBe('COMPLETED');

      // 3. The app is force-closed and reopened, still offline.
      online.engine.dispose();
      online.db.close();
      opened.pop();
      const reopened = await setup([], { file, server });
      opened.push(reopened.db);
      expect(await reopened.store.getJob('job-1')).toMatchObject({
        job: { status: 'COMPLETED' },
        pendingChanges: 3,
      });

      // 4. The connection returns, but two responses are lost on the way back (each
      //    looks like a dropped connection, so the cycle stops and the retry timer resumes).
      server.online = true;
      server.faults.push({ type: 'lostResponse' }, { type: 'lostResponse' });
      let status = await reopened.engine.sync();
      for (let cycle = 0; cycle < 5 && status.phase !== 'idle'; cycle += 1) {
        status = await reopened.engine.sync();
      }

      // 5. Exactly one logical mutation each, and both sides agree.
      expect(server.effects).toBe(3);
      expect(server.jobs.get('job-1')).toMatchObject({
        status: 'COMPLETED',
        fieldNotes: [
          expect.objectContaining({
            body: 'Compressor replaced',
            author: WORKER,
          }),
        ],
      });
      expect(await reopened.store.getJob('job-1')).toMatchObject({
        job: {
          status: 'COMPLETED',
          version: server.jobs.get('job-1')?.version,
          fieldNotes: [
            expect.objectContaining({ body: 'Compressor replaced' }),
          ],
        },
        pendingChanges: 0,
        problems: 0,
      });
      expect(status).toMatchObject({ phase: 'idle', pending: 0, failed: 0 });
    } finally {
      opened.forEach(db => db.close());
      removeDatabaseFile(file);
    }
  });
});

describe('JobSyncEngine — field operations (Phase 4)', () => {
  const FIX = {
    latitude: 28.6149,
    longitude: 77.209,
    accuracyMeters: 8,
    capturedAt: '2026-09-27T08:00:00.000Z',
  };
  const photo = (id = 'evidence-1') => ({
    evidenceId: id,
    fileUri: `file:///data/files/evidence/${id}.jpg`,
    contentType: 'image/jpeg' as const,
    sizeBytes: 90_000,
    width: 1920,
    height: 1080,
  });

  /** A file store standing in for app-private storage. */
  const fakeFiles = (present: string[]) => {
    const files = new Set(present);
    return {
      files,
      remover: {
        remove: async (uri: string) => {
          files.delete(uri);
        },
      },
    };
  };

  async function setupWithFiles(present: string[]) {
    const context = await setup();
    const { files, remover } = fakeFiles(present);
    const engine = new JobSyncEngine({
      store: context.store,
      transport: context.server,
      now: context.clock.now,
      random: () => 0.5,
      timers: context.timers,
      files: remover,
    });
    await engine.sync();
    return { ...context, engine, files };
  }

  it('sends the position captured with a start and a completion', async () => {
    const { store, engine, server } = await downloaded(await setup());
    await store.startJob('job-1', FIX);
    await store.completeJob('job-1', null);

    await engine.sync();

    const commands = server.calls.filter(call => call.operation !== 'pull');
    expect(commands.map(call => [call.operation, call.body])).toEqual([
      ['job.start', { location: FIX }],
      ['job.complete', {}],
    ]);
    expect(server.jobs.get('job-1')?.startLocation).toMatchObject(FIX);
  });

  it('keeps a position captured offline across a restart and sends it once', async () => {
    const file = tempDatabasePath();
    try {
      const first = await downloaded(await setup([serverJob()], { file }));
      first.server.online = false;
      await first.store.startJob('job-1', FIX);
      await first.engine.sync();
      first.engine.dispose();
      first.db.close();

      const second = await setup([], { file, server: first.server });
      second.server.online = true;
      await second.engine.sync();

      expect(second.server.effects).toBe(1);
      expect(second.server.jobs.get('job-1')?.startLocation).toMatchObject(FIX);
      second.db.close();
    } finally {
      removeDatabaseFile(file);
    }
  });

  it('uploads a photo through the outbox and shows it as uploaded', async () => {
    const { store, engine, server } = await downloaded(await setup());
    await store.addEvidence('job-1', photo());
    expect(await store.evidenceFiles('job-1')).toEqual([
      expect.objectContaining({ evidenceId: 'evidence-1', state: 'pending' }),
    ]);
    expect((await store.getJob('job-1'))?.job.evidence).toHaveLength(1);

    await engine.sync();

    expect(operations(server)).toEqual(['job.evidence.add']);
    expect(server.jobs.get('job-1')?.evidence.map(item => item.id)).toEqual([
      'evidence-1',
    ]);
    expect(await store.evidenceFiles('job-1')).toEqual([
      expect.objectContaining({ evidenceId: 'evidence-1', state: 'uploaded' }),
    ]);
    const local = await store.getJob('job-1');
    expect(local?.pendingChanges).toBe(0);
    expect(local?.job.evidence).toHaveLength(1);
  });

  it('keeps a photo pending while offline, and uploads it exactly once after lost responses', async () => {
    const { store, engine, server } = await downloaded(await setup());
    await store.addEvidence('job-1', photo());

    server.online = false;
    await engine.sync();
    expect(await store.evidenceFiles('job-1')).toEqual([
      expect.objectContaining({ state: 'pending' }),
    ]);

    server.online = true;
    server.faults.push({ type: 'lostResponse' });
    await engine.sync();
    await engine.sync();

    expect(server.effects).toBe(1);
    expect(server.jobs.get('job-1')?.evidence).toHaveLength(1);
    expect(await store.evidenceFiles('job-1')).toEqual([
      expect.objectContaining({ state: 'uploaded' }),
    ]);
  });

  it('fails an upload for good when the server refuses the file, and says so', async () => {
    const { store, engine, server } = await downloaded(await setup());
    await store.addEvidence('job-1', photo());
    server.faults.push({
      type: 'http',
      status: 415,
      code: 'UNSUPPORTED_FILE_TYPE',
    });

    const status = await engine.sync();

    expect(status.failed).toBe(1);
    expect(await store.evidenceFiles('job-1')).toEqual([
      expect.objectContaining({ state: 'failed' }),
    ]);
    // Refused photos no longer appear on the job.
    expect((await store.getJob('job-1'))?.job.evidence).toEqual([]);
  });

  it('deletes a photo file once its upload is dismissed', async () => {
    const uri = photo().fileUri;
    const { store, engine, server, files } = await setupWithFiles([uri]);
    await store.addEvidence('job-1', photo());
    server.faults.push({ type: 'http', status: 413, code: 'PAYLOAD_TOO_LARGE' });
    await engine.sync();
    const [problem] = await store.problemEntries();

    await store.dismiss(problem?.seq ?? -1);
    await engine.sync();

    expect(files.has(uri)).toBe(false);
    expect(await store.evidenceFiles('job-1')).toEqual([]);
  });

  it('keeps an uploaded photo file while the job is on the phone, then deletes it', async () => {
    const uri = photo().fileUri;
    const { store, engine, server, files } = await setupWithFiles([uri]);
    await store.addEvidence('job-1', photo());
    await engine.sync();
    expect(files.has(uri)).toBe(true);

    // The job is reassigned: it leaves the phone, and so does its photo file.
    server.reassign('job-1', { id: 'worker-2', firstName: 'B', lastName: 'B' });
    await engine.sync();

    expect(files.has(uri)).toBe(false);
  });

  it('sends job messages written offline, in order, exactly once', async () => {
    const { store, engine, server } = await downloaded(await setup());
    server.online = false;
    await store.sendMessage('job-1', 'Need a ladder');
    await store.sendMessage('job-1', 'Found one');
    await engine.sync();
    expect((await store.getJob('job-1'))?.job.messages).toHaveLength(2);

    server.online = true;
    await engine.sync();

    expect(server.jobs.get('job-1')?.messages.map(item => item.body)).toEqual([
      'Need a ladder',
      'Found one',
    ]);
    expect(server.effects).toBe(2);
  });
});
