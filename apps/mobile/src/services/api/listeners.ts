import { setupListeners } from '@reduxjs/toolkit/query';
import type { Dispatch } from '@reduxjs/toolkit';
import { AppState } from 'react-native';

import type { ConnectivityStatus } from '../network/connectivity';
import { subscribeToConnectivity } from '../network/connectivityService';

/**
 * Connects RTK Query's focus/reconnect behavior to React Native. React Native has no browser
 * `online`/`focus` events, so AppState and FieldOps' connectivity service provide them.
 * Returns a cleanup function.
 */
export function setupApiListeners(dispatch: Dispatch): () => void {
  return setupListeners(
    dispatch,
    (innerDispatch, { onFocus, onFocusLost, onOnline, onOffline }) => {
      const appStateSubscription = AppState.addEventListener(
        'change',
        state => {
          innerDispatch(state === 'active' ? onFocus() : onFocusLost());
        },
      );

      // Only dispatch on real transitions: each onOnline triggers a refetch of active queries.
      let lastStatus: ConnectivityStatus | undefined;
      const unsubscribeConnectivity = subscribeToConnectivity(({ status }) => {
        if (
          status === lastStatus ||
          (status !== 'online' && status !== 'offline')
        ) {
          return;
        }
        lastStatus = status;
        innerDispatch(status === 'online' ? onOnline() : onOffline());
      });

      return () => {
        appStateSubscription.remove();
        unsubscribeConnectivity();
      };
    },
  );
}
