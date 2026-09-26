import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ConnectivitySnapshot } from '../../services/network/connectivity';

/**
 * Application state: the device's current connectivity, kept small on purpose. Besides the
 * latest snapshot it records the offline -> online transition so the UI can show
 * "Reconnecting…" and "Back online" without keeping its own history.
 */
export interface ConnectivityState extends ConnectivitySnapshot {
  /** Epoch milliseconds of the last status change. */
  readonly lastChangedAt: number | null;
  /** True from the moment the device goes offline until it is online again. */
  readonly recoveringFromOffline: boolean;
  /** Epoch milliseconds of the last offline -> online recovery. */
  readonly restoredAt: number | null;
}

const initialState: ConnectivityState = {
  status: 'unknown',
  connectionType: 'unknown',
  isInternetReachable: null,
  lastChangedAt: null,
  recoveringFromOffline: false,
  restoredAt: null,
};

export const connectivitySlice = createSlice({
  name: 'connectivity',
  initialState,
  reducers: {
    connectivityChanged: {
      reducer(
        state,
        action: PayloadAction<
          ConnectivitySnapshot,
          string,
          { receivedAt: number }
        >,
      ) {
        const { status, connectionType, isInternetReachable } = action.payload;
        state.connectionType = connectionType;
        state.isInternetReachable = isInternetReachable;
        if (status === state.status) {
          return;
        }
        state.status = status;
        state.lastChangedAt = action.meta.receivedAt;
        if (status === 'offline') {
          state.recoveringFromOffline = true;
        } else if (status === 'online' && state.recoveringFromOffline) {
          state.recoveringFromOffline = false;
          state.restoredAt = action.meta.receivedAt;
        }
      },
      // Reducers must be pure, so the timestamp is captured when the action is created.
      prepare(snapshot: ConnectivitySnapshot) {
        return { payload: snapshot, meta: { receivedAt: Date.now() } };
      },
    },
  },
  selectors: {
    selectConnectivity: state => state,
    selectConnectivityStatus: state => state.status,
  },
});

export const { connectivityChanged } = connectivitySlice.actions;
export const { selectConnectivity, selectConnectivityStatus } =
  connectivitySlice.selectors;
export default connectivitySlice.reducer;
