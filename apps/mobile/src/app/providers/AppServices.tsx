import { useEffect } from 'react';

import { setupApiListeners } from '../../services/api/listeners';
import { subscribeToConnectivity } from '../../services/network/connectivityService';
import { useAppDispatch } from '../../store/hooks';
import { connectivityChanged } from '../../store/slices/connectivitySlice';

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

  return null;
}
