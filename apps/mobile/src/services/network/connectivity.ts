/**
 * Connectivity model (pure, no native imports).
 *
 * NetInfo reports two separate facts: whether a network interface is connected, and whether
 * the internet is actually reachable through it (captive portals and dead Wi-Fi are
 * "connected" but unreachable). FieldOps folds them into one status:
 *
 *   unknown   - no information yet (app just started)
 *   checking  - connected, reachability not confirmed yet (transitioning)
 *   online    - connected and the internet is reachable
 *   offline   - no connection, or connected without internet access
 *
 * This is a hint for the UI and for triggering work. It is never proof that a request will
 * succeed; the sync engine (Version 6) treats a successful request as the only real proof.
 */

export type ConnectivityStatus = 'unknown' | 'checking' | 'online' | 'offline';

export interface ConnectivitySnapshot {
  readonly status: ConnectivityStatus;
  /** NetInfo connection type, e.g. `wifi`, `cellular`, `none`, `unknown`. */
  readonly connectionType: string;
  readonly isInternetReachable: boolean | null;
}

/** The subset of NetInfo's state this module depends on. */
export interface NetworkStateLike {
  readonly type: string;
  readonly isConnected: boolean | null;
  readonly isInternetReachable: boolean | null | undefined;
}

export function deriveConnectivityStatus(
  state: Pick<NetworkStateLike, 'isConnected' | 'isInternetReachable'>,
): ConnectivityStatus {
  if (state.isConnected === false) {
    return 'offline';
  }
  if (state.isConnected === null) {
    return 'unknown';
  }
  if (state.isInternetReachable === false) {
    return 'offline';
  }
  if (state.isInternetReachable === true) {
    return 'online';
  }
  return 'checking';
}

export function toConnectivitySnapshot(
  state: NetworkStateLike,
): ConnectivitySnapshot {
  return {
    status: deriveConnectivityStatus(state),
    connectionType: state.type,
    isInternetReachable: state.isInternetReachable ?? null,
  };
}

export function describeConnectivityStatus(status: ConnectivityStatus): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'offline':
      return 'Offline';
    case 'checking':
      return 'Checking connection…';
    case 'unknown':
      return 'Unknown';
  }
}
