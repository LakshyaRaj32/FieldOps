import { useEffect } from 'react';

import { restoreSession } from '../../features/auth/session';
import { setupApiListeners } from '../../services/api/listeners';
import { subscribeToConnectivity } from '../../services/network/connectivityService';
import { useAppDispatch } from '../../store/hooks';
import { connectivityChanged } from '../../store/slices/connectivitySlice';
import { signedOut } from '../../store/slices/sessionSlice';
import { logger } from '../../utils/logger';

/**
 * Connects long-lived services to the store for the lifetime of the app. Services stay
 * independent of Redux; this component is the only place that wires them together.
 */
export function AppServices(): null {
  const dispatch = useAppDispatch();

  useEffect(
    () =>
      subscribeToConnectivity(snapshot =>
        dispatch(connectivityChanged(snapshot)),
      ),
    [dispatch],
  );

  useEffect(() => setupApiListeners(dispatch), [dispatch]);

  // Read the stored session once at startup (the navigator waits in `restoring`). Never
  // leave the app stuck on the startup screen: fall back to the sign-in screen.
  useEffect(() => {
    dispatch(restoreSession()).catch((error: unknown) => {
      logger.error('Session restore failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      dispatch(signedOut(undefined));
    });
  }, [dispatch]);

  return null;
}
