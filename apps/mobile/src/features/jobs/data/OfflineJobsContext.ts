import { createContext, useContext, useEffect, useState } from 'react';

import type { LocalJobStore } from './localJobStore';
import type { JobSyncEngine, SyncStatus } from './syncEngine';
import type { LocalJob, OutboxEntry } from './types';

export interface OfflineJobs {
  readonly store: LocalJobStore;
  readonly engine: JobSyncEngine;
  readonly status: SyncStatus;
}

/**
 * The signed-in worker's offline data (null for managers and admins, whose screens stay
 * online, and while the database is opening). Provided by OfflineJobsProvider.
 */
export const OfflineJobsContext = createContext<OfflineJobs | null>(null);

export function useOfflineJobs(): OfflineJobs | null {
  return useContext(OfflineJobsContext);
}

export interface LocalQuery<Result> {
  readonly data: Result | undefined;
  readonly error: unknown;
}

/**
 * Runs a read against the local store and runs it again after every committed change (a
 * local command, a sync result). This is how worker screens react to SQLite.
 */
function useLocalQuery<Result>(
  read: ((store: LocalJobStore) => Promise<Result>) | null,
  key: string,
): LocalQuery<Result> {
  const offline = useOfflineJobs();
  const store = offline?.store;
  const [state, setState] = useState<LocalQuery<Result>>({
    data: undefined,
    error: undefined,
  });

  useEffect(() => {
    if (store === undefined || read === null) {
      return undefined;
    }
    let active = true;
    const load = () => {
      read(store).then(
        data => active && setState({ data, error: undefined }),
        (error: unknown) =>
          active && setState(current => ({ ...current, error })),
      );
    };
    load();
    const unsubscribe = store.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
    // `key` identifies the query; `read` is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);

  return state;
}

export function useLocalJobs(
  statuses: readonly LocalJob['job']['status'][],
  order: 'asc' | 'desc',
): LocalQuery<LocalJob[]> {
  return useLocalQuery(
    store => store.listJobs(statuses, order),
    `${statuses.join(',')}:${order}`,
  );
}

/** `data` is null when the job is not (or no longer) on the device. */
export function useLocalJob(jobId: string): LocalQuery<LocalJob | null> {
  return useLocalQuery(store => store.getJob(jobId), jobId);
}

export function useProblemEntries(jobId?: string): LocalQuery<OutboxEntry[]> {
  return useLocalQuery(
    store => store.problemEntries(jobId),
    `problems:${jobId ?? '*'}`,
  );
}
