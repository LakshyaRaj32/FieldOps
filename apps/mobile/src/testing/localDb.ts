import { JOB_MIGRATIONS } from '../features/jobs/data/localSchema';
import { LocalJobStore } from '../features/jobs/data/localJobStore';
import type { SqlDatabase } from '../services/db/database';
import { migrate } from '../services/db/migrations';
import { WORKER } from './fakeJobServer';
import { openNodeSqliteDatabase } from './nodeSqliteDatabase';

/** A controllable clock for the store and the sync engine. */
export function testClock(start = '2026-09-27T08:00:00.000Z') {
  let current = Date.parse(start);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

/** A temporary database file, so a test can "restart the app" by reopening it. */
export function tempDatabasePath(): string {
  const os = require('node:os') as { tmpdir(): string };
  const path = require('node:path') as { join(...parts: string[]): string };
  return path.join(
    os.tmpdir(),
    `fieldops-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

export function removeDatabaseFile(file: string): void {
  const fs = require('node:fs') as { rmSync(p: string, o: object): void };
  fs.rmSync(file, { force: true });
}

/** Opens (and migrates) a worker database, like the app does at sign-in. */
export async function openStore(
  clock: ReturnType<typeof testClock>,
  file?: string,
  wrap: (db: SqlDatabase) => SqlDatabase = db => db,
): Promise<{ db: SqlDatabase; store: LocalJobStore }> {
  const db = wrap(openNodeSqliteDatabase(file));
  await migrate(db, JOB_MIGRATIONS);
  return { db, store: new LocalJobStore({ db, me: WORKER, now: clock.now }) };
}
