import NetInfo from '@react-native-community/netinfo';

import {
  toConnectivitySnapshot,
  type ConnectivitySnapshot,
} from './connectivity';

export type ConnectivityListener = (snapshot: ConnectivitySnapshot) => void;

/**
 * Subscribes to connectivity changes. The listener is called immediately with the current
 * state and again on every change. Returns an unsubscribe function.
 *
 * This is the only module that talks to NetInfo (enforced by ESLint), so the rest of the
 * app depends on FieldOps' connectivity model rather than on the library.
 */
export function subscribeToConnectivity(
  listener: ConnectivityListener,
): () => void {
  return NetInfo.addEventListener(state =>
    listener(toConnectivitySnapshot(state)),
  );
}

/** Forces a fresh reachability check (for example from a "retry" action). */
export async function refreshConnectivity(): Promise<ConnectivitySnapshot> {
  return toConnectivitySnapshot(await NetInfo.refresh());
}
