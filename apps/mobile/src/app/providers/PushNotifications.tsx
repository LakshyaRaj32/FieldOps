import React, {
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { notificationsApi } from '../../features/notifications/api/notificationsApi';
import { routeFor } from '../../features/notifications/notificationRouting';
import { PushStatusContext, type PushStatus } from '../../hooks/useLiveUpdates';
import {
  currentPushToken,
  discardPushToken,
  isPushAvailable,
  listenForPush,
  requestPushPermission,
} from '../../services/push/pushService';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { selectSession } from '../../store/slices/sessionSlice';
import { logger } from '../../utils/logger';
import {
  openJobWhenReady,
  openShopWhenReady,
  openNotificationsWhenReady,
} from '../navigation/navigationRef';
import { useResync } from './RealtimeConnection';

/** The job a push message is about, if it names one. */
function jobIdOf(data: Readonly<Record<string, string>> | null) {
  const { jobId } = data ?? {};
  return typeof jobId === 'string' && jobId !== '' ? jobId : undefined;
}

/**
 * Push notifications for the signed-in user (docs/notifications.md):
 *
 * - after sign-in, asks for the notification permission (Android 13+) and registers this
 *   device's FCM token with the API, bound to the session; a rotated token is registered
 *   again;
 * - a tap opens the job (app in the background, or started by the tap); the job is loaded
 *   through the normal path, so an unknown job shows "looking for this job" and then syncs;
 * - a message while the app is open refreshes (the realtime channel has usually done so);
 * - an explicit sign-out discards the token on the phone (the server already dropped the
 *   registration with the session).
 */
export function PushNotifications({
  children,
}: PropsWithChildren): React.JSX.Element {
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectSession);
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const resync = useResync();
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  const [status, setStatus] = useState<PushStatus>(
    isPushAvailable() ? 'pending' : 'unavailable',
  );

  useEffect(() => {
    if (userId === null || !isPushAvailable()) {
      return undefined;
    }
    let active = true;
    const register = (token: string) => {
      dispatch(notificationsApi.endpoints.registerPushDevice.initiate(token))
        .unwrap()
        .then(() => active && setStatus('on'))
        .catch(() => {
          // Offline or a server problem: registered again on the next start or rotation.
          logger.warn('Push registration failed');
        });
    };

    (async () => {
      const permission = await requestPushPermission();
      if (!active) {
        return;
      }
      if (permission !== 'granted') {
        setStatus('off');
        return;
      }
      const token = await currentPushToken();
      if (active && token !== null) {
        register(token);
      }
    })().catch(() => undefined);

    const unsubscribe = listenForPush({
      onToken: register,
      onForegroundMessage: data => {
        resyncRef.current(jobIdOf(data));
      },
      onOpened: data => {
        const route = routeFor(data);
        if (route?.screen === 'job') {
          openJobWhenReady(route.jobId);
        } else if (route?.screen === 'shop') {
          openShopWhenReady(route.shopId);
        } else if (route?.screen === 'inbox') {
          openNotificationsWhenReady();
        }
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [dispatch, userId]);

  // An explicit sign-out: the next person on this phone gets a new token.
  const explicitSignOut =
    session.status === 'signedOut' && session.reason === 'signedOut';
  useEffect(() => {
    if (explicitSignOut) {
      discardPushToken().catch(() => undefined);
      setStatus(isPushAvailable() ? 'pending' : 'unavailable');
    }
  }, [explicitSignOut]);

  return (
    <PushStatusContext.Provider value={status}>
      {children}
    </PushStatusContext.Provider>
  );
}
