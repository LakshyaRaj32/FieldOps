import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { authApi } from '../../features/auth/api/authApi';
import { jobsApi } from '../../features/jobs/api/jobsApi';
import { useOfflineJobs } from '../../features/jobs/data/OfflineJobsContext';
import { notificationsApi } from '../../features/notifications/api/notificationsApi';
import { useConnectivity } from '../../hooks/useConnectivity';
import { RealtimeStatusContext } from '../../hooks/useLiveUpdates';
import { credentialStore } from '../../services/auth/credentialStore';
import {
  RealtimeClient,
  type RealtimeStatus,
} from '../../services/realtime/realtimeClient';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectSession } from '../../store/slices/sessionSlice';
import { getConfig } from '../config';

/**
 * Hook the app refreshes with when the server hints that something changed: the worker's
 * sync engine runs (SQLite converges with the server), and online data (manager screens,
 * the inbox) is refetched. Realtime never writes data itself (docs/realtime.md).
 */
export function useResync(): (jobId?: string) => void {
  const dispatch = useAppDispatch();
  const offline = useOfflineJobs();
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  return useCallback(
    (jobId?: string) => {
      offlineRef.current?.engine.sync().catch(() => undefined);
      dispatch(
        jobsApi.util.invalidateTags(
          jobId === undefined
            ? ['Job']
            : [
                { type: 'Job', id: jobId },
                { type: 'Job', id: 'LIST' },
              ],
        ),
      );
      dispatch(notificationsApi.util.invalidateTags(['Notification']));
    },
    [dispatch],
  );
}

/**
 * The realtime connection for the signed-in user. Connected only while it is useful: the
 * app is in the foreground and the phone has a network. In the background, push (FCM)
 * takes over, and sync on the next foreground catches up with anything missed.
 */
export function RealtimeConnection({
  children,
}: PropsWithChildren): React.JSX.Element {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const resync = useResync();
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  const { status: connectivity } = useConnectivity();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState<RealtimeStatus>('stopped');
  const [client, setClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);

  // One client per signed-in user; a new user gets a fresh one.
  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    const created = new RealtimeClient({
      url: getConfig().apiBaseUrl,
      getAccessToken: () => credentialStore.getAccessToken(),
      refreshSession: async () => {
        // Any authenticated request refreshes an expired token (one shared refresh).
        const result = await dispatch(
          authApi.endpoints.me.initiate(undefined, {
            subscribe: false,
            forceRefetch: true,
          }),
        );
        return result.data !== undefined;
      },
      onEvent: event => resyncRef.current(event.data.jobId),
      // After every (re)connection: whatever was missed meanwhile arrives through sync.
      onConnected: () => resyncRef.current(),
      onStatus: setStatus,
    });
    setClient(created);
    return () => {
      created.stop();
      setClient(null);
      setStatus('stopped');
    };
  }, [dispatch, userId]);

  useEffect(() => {
    if (client === null) {
      return;
    }
    if (active && connectivity !== 'offline') {
      client.start();
    } else {
      client.stop();
    }
  }, [client, active, connectivity]);

  return (
    <RealtimeStatusContext.Provider value={status}>
      {children}
    </RealtimeStatusContext.Provider>
  );
}
