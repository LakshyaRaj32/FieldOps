import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { Role } from '@fieldops/types';

import { useConnectivity } from '../../../hooks/useConnectivity';
import { openNitroDatabase } from '../../../services/db/nitroDatabase';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { selectSession } from '../../../store/slices/sessionSlice';
import { logger } from '../../../utils/logger';
import { createApiTransport } from './apiTransport';
import { OfflineJobsContext, type OfflineJobs } from './OfflineJobsContext';
import { openOfflineSession, type OfflineSession } from './offlineSession';
import type { SyncStatus } from './syncEngine';

/**
 * Opens the signed-in worker's local database and runs the sync engine for as long as they
 * are signed in, including after an offline app start (the session is restored from secure
 * storage without the network).
 *
 * Sync triggers: the database opening (app start, sign-in), the app coming to the
 * foreground, connectivity returning, and local commands (the screens request a sync after
 * each). Retries between those are scheduled by the engine itself.
 */
export function OfflineJobsProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const worker =
    session.status === 'signedIn' && session.user.role === Role.WORKER
      ? session.user
      : null;
  const workerId = worker?.id ?? null;
  const workerRef = useRef(worker);
  workerRef.current = worker;

  const [offline, setOffline] = useState<OfflineSession | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const me = workerRef.current;
    if (workerId === null || me === null) {
      return undefined;
    }
    let active = true;
    let opened: OfflineSession | null = null;
    let unsubscribe = () => undefined as void;

    openOfflineSession(
      { id: me.id, firstName: me.firstName, lastName: me.lastName },
      openNitroDatabase,
      createApiTransport(dispatch),
    )
      .then(session_ => {
        if (!active) {
          session_.release().catch(() => undefined);
          return;
        }
        opened = session_;
        unsubscribe = session_.engine.subscribe(setStatus);
        setStatus(session_.engine.status());
        setOffline(session_);
        session_.engine.sync().catch(() => undefined);
      })
      .catch((error: unknown) => {
        logger.error('Could not open the local database', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
      unsubscribe();
      setOffline(null);
      setStatus(null);
      if (opened !== null) {
        // An explicit sign-out removes the local data, unless something is still unsynced.
        const now = sessionRef.current;
        const explicit =
          now.status === 'signedOut' && now.reason === 'signedOut';
        opened.release({ discardIfSynced: explicit }).catch(() => undefined);
      }
    };
  }, [dispatch, workerId]);

  // Foreground → sync.
  useEffect(() => {
    if (offline === null) {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        offline.engine.sync().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [offline]);

  // Connectivity regained → sync. A hint only: the request's outcome decides.
  const { status: connectivity } = useConnectivity();
  useEffect(() => {
    if (offline !== null && connectivity === 'online') {
      offline.engine.sync().catch(() => undefined);
    }
  }, [offline, connectivity]);

  const value = useMemo<OfflineJobs | null>(
    () =>
      offline === null || status === null
        ? null
        : { store: offline.store, engine: offline.engine, status },
    [offline, status],
  );

  return (
    <OfflineJobsContext.Provider value={value}>
      {children}
    </OfflineJobsContext.Provider>
  );
}
