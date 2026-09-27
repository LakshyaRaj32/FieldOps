import type { UserSummary } from '@fieldops/types';

import type { SqlDatabase } from '../../../services/db/database';
import { migrate } from '../../../services/db/migrations';
import { JOB_MIGRATIONS } from './localSchema';
import { LocalJobStore } from './localJobStore';
import {
  JobSyncEngine,
  type EvidenceFileRemover,
  type JobSyncTransport,
} from './syncEngine';

/** Everything offline work needs for one signed-in worker. */
export interface OfflineSession {
  readonly store: LocalJobStore;
  readonly engine: JobSyncEngine;
  /**
   * Ends the session. With `discardIfSynced`, the database file is deleted when nothing is
   * left to sync (an explicit sign-out leaves no job data behind). Otherwise, and always
   * when changes are unsynced, the file stays: unsynced work is never discarded, and it
   * syncs after the same worker signs in again.
   */
  release(options?: { readonly discardIfSynced?: boolean }): Promise<void>;
}

/**
 * The database file allows one open connection. A new session waits until the previous one
 * is fully released (it may be waiting for a sync cycle), for example after a quick sign-out
 * and sign-in.
 */
let previousRelease: Promise<void> = Promise.resolve();

/** One database file per user: another user signing in on the device never sees it. */
export const databaseNameFor = (userId: string) => `fieldops-${userId}.sqlite`;

export async function openOfflineSession(
  me: UserSummary,
  openDatabase: (name: string) => SqlDatabase,
  transport: JobSyncTransport,
  files?: EvidenceFileRemover,
): Promise<OfflineSession> {
  await previousRelease;
  const db = openDatabase(databaseNameFor(me.id));
  try {
    // Before anything reads: a failed migration leaves the previous version intact.
    await migrate(db, JOB_MIGRATIONS);
  } catch (error) {
    db.close();
    throw error;
  }
  const store = new LocalJobStore({ db, me });
  const engine = new JobSyncEngine({
    store,
    transport,
    ...(files !== undefined && { files }),
  });

  return {
    store,
    engine,
    release({ discardIfSynced = false } = {}) {
      const releasing = (async () => {
        engine.dispose();
        // The connection cannot close while a cycle is still using it.
        await engine.whenIdle();
        const counts = await store.counts();
        const clean =
          counts.pending === 0 && counts.failed === 0 && counts.conflicts === 0;
        if (discardIfSynced && clean) {
          db.destroy();
        } else {
          db.close();
        }
      })();
      previousRelease = releasing.catch(() => undefined);
      return releasing;
    },
  };
}
