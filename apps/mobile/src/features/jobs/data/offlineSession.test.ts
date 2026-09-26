/**
 * @jest-environment node
 */
import {
  FakeJobServer,
  serverJob,
  WORKER,
} from '../../../testing/fakeJobServer';
import { openNodeSqliteDatabase } from '../../../testing/nodeSqliteDatabase';
import type { SqlDatabase } from '../../../services/db/database';
import { databaseNameFor, openOfflineSession } from './offlineSession';

/** Like the device library: one open connection per database name. */
function fakeOpener() {
  const open = new Set<string>();
  const events: string[] = [];
  const openDatabase = (name: string): SqlDatabase => {
    if (open.has(name)) {
      throw new Error(`${name} is already open`);
    }
    open.add(name);
    events.push(`open ${name}`);
    const db = openNodeSqliteDatabase();
    return {
      ...db,
      close: () => {
        open.delete(name);
        events.push(`close ${name}`);
        db.close();
      },
      destroy: () => {
        open.delete(name);
        events.push(`destroy ${name}`);
        db.destroy();
      },
    };
  };
  return { openDatabase, events };
}

describe('openOfflineSession', () => {
  it('uses one database file per user', () => {
    expect(databaseNameFor(WORKER.id)).toBe('fieldops-worker-1.sqlite');
  });

  it('opens a new session only after the previous one is released (quick sign-out, sign-in)', async () => {
    const { openDatabase, events } = fakeOpener();
    const server = new FakeJobServer([serverJob()]);
    const first = await openOfflineSession(WORKER, openDatabase, server);
    await first.engine.sync();

    const released = first.release();
    const second = await openOfflineSession(WORKER, openDatabase, server);
    await released;

    const name = databaseNameFor(WORKER.id);
    // The second open waited for the first connection to close.
    expect(events).toEqual([`open ${name}`, `close ${name}`, `open ${name}`]);
    await second.release();
  });

  it('keeps the file on sign-out while changes are unsynced, deletes it once everything is synced', async () => {
    const { openDatabase, events } = fakeOpener();
    const server = new FakeJobServer([serverJob()]);
    const name = databaseNameFor(WORKER.id);

    const withPending = await openOfflineSession(WORKER, openDatabase, server);
    await withPending.engine.sync();
    server.online = false;
    await withPending.store.startJob('job-1');
    await withPending.release({ discardIfSynced: true });
    expect(events.at(-1)).toBe(`close ${name}`);

    server.online = true;
    const synced = await openOfflineSession(WORKER, openDatabase, server);
    await synced.engine.sync();
    await synced.release({ discardIfSynced: true });
    expect(events.at(-1)).toBe(`destroy ${name}`);
  });
});
