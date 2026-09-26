/**
 * @jest-environment node
 */
import { serverJob } from '../../../testing/fakeJobServer';
import {
  openStore,
  removeDatabaseFile,
  tempDatabasePath,
  testClock,
} from '../../../testing/localDb';
import type { SqlDatabase } from '../../../services/db/database';
import { LocalCommandError } from './types';

const snapshot = (...jobs: ReturnType<typeof serverJob>[]) => ({
  jobs,
  generatedAt: '2026-09-27T08:00:00.000Z',
});

describe('LocalJobStore', () => {
  const clock = testClock();
  let file: string;

  beforeEach(() => {
    file = tempDatabasePath();
  });

  afterEach(() => {
    removeDatabaseFile(file);
  });

  it('stores the working set and lists it by status and schedule', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(
      snapshot(
        serverJob({ id: 'late', scheduledAt: '2026-09-29T05:00:00.000Z' }),
        serverJob({ id: 'early', scheduledAt: '2026-09-28T05:00:00.000Z' }),
        serverJob({ id: 'done', status: 'COMPLETED' }),
      ),
    );

    const active = await store.listJobs(['ASSIGNED', 'IN_PROGRESS'], 'asc');
    expect(active.map(item => item.job.id)).toEqual(['early', 'late']);
    expect((await store.getJob('done'))?.job.status).toBe('COMPLETED');
  });

  it('keeps jobs and pending commands across an app restart', async () => {
    const first = await openStore(clock, file);
    await first.store.applyWorkingSet(snapshot(serverJob()));
    await first.store.startJob('job-1');
    first.db.close(); // the app is killed

    const second = await openStore(clock, file);

    const job = await second.store.getJob('job-1');
    expect(job?.job.status).toBe('IN_PROGRESS');
    expect(job?.pendingChanges).toBe(1);
    const [entry] = await second.store.pendingEntries();
    expect(entry).toMatchObject({ type: 'job.start', status: 'pending' });
    second.db.close();
  });

  it('writes the local change and its outbox entry together', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(snapshot(serverJob()));

    const entry = await store.startJob('job-1');

    expect(entry).toMatchObject({
      type: 'job.start',
      jobId: 'job-1',
      jobTitle: 'AC repair',
      baseVersion: 2,
      status: 'pending',
      attempts: 0,
    });
    expect(entry.mutationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect((await store.getJob('job-1'))?.job.status).toBe('IN_PROGRESS');
  });

  it('writes neither when the transaction fails half-way (atomicity)', async () => {
    // Simulates a crash after the outbox insert, before the local view is updated.
    const crashing = (db: SqlDatabase): SqlDatabase => ({
      ...db,
      transaction: work =>
        db.transaction(tx =>
          work({
            all: tx.all,
            run: (sql, params) => {
              if (sql.startsWith('UPDATE jobs SET local_json') && armed) {
                throw new Error('crash');
              }
              tx.run(sql, params);
            },
          }),
        ),
    });
    let armed = false;
    const { store } = await openStore(clock, undefined, crashing);
    await store.applyWorkingSet(snapshot(serverJob()));
    armed = true;

    await expect(store.startJob('job-1')).rejects.toThrow('crash');

    expect(await store.pendingEntries()).toEqual([]);
    expect((await store.getJob('job-1'))?.job.status).toBe('ASSIGNED');
  });

  it('refuses a command the local state does not allow, writing nothing', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(snapshot(serverJob()));

    await expect(store.completeJob('job-1')).rejects.toBeInstanceOf(
      LocalCommandError,
    );
    await expect(store.startJob('unknown')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
    expect(await store.pendingEntries()).toEqual([]);
  });

  it('never loses pending work when a fresh server copy arrives', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(snapshot(serverJob()));
    await store.startJob('job-1');
    await store.addNote('job-1', '  Filter replaced  ');

    // A download that does not know about the commands yet.
    await store.applyWorkingSet(
      snapshot(serverJob({ title: 'AC repair (2 units)' })),
    );

    const local = await store.getJob('job-1');
    expect(local?.job).toMatchObject({
      title: 'AC repair (2 units)',
      status: 'IN_PROGRESS',
      fieldNotes: [expect.objectContaining({ body: 'Filter replaced' })],
    });
    expect(local?.pendingChanges).toBe(2);
  });

  it('removes a job the server no longer sends, unless commands for it are pending', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(
      snapshot(serverJob({ id: 'kept' }), serverJob({ id: 'gone' })),
    );
    await store.startJob('kept');

    await store.applyWorkingSet(snapshot());

    expect(await store.getJob('gone')).toBeNull();
    expect((await store.getJob('kept'))?.job.status).toBe('IN_PROGRESS');
  });

  it('ignores a server copy older than the stored one', async () => {
    const { store } = await openStore(clock);
    await store.applyWorkingSet(
      snapshot(serverJob({ version: 5, title: 'New' })),
    );

    await store.applyWorkingSet(
      snapshot(serverJob({ version: 4, title: 'Old' })),
    );

    expect((await store.getJob('job-1'))?.job.title).toBe('New');
  });

  it('notifies subscribers after each committed change', async () => {
    const { store } = await openStore(clock);
    const listener = jest.fn();
    store.subscribe(listener);

    await store.applyWorkingSet(snapshot(serverJob()));
    await store.startJob('job-1');

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
