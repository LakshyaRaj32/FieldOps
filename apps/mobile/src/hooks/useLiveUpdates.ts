import { createContext, useContext } from 'react';

import type { RealtimeStatus } from '../services/realtime/realtimeClient';

/**
 * How the app currently hears about changes, for display (Profile). Set by the app shell
 * (app/providers/RealtimeConnection and PushNotifications).
 */
export const RealtimeStatusContext = createContext<RealtimeStatus>('stopped');

/**
 * - `unavailable`: this build has no Firebase configuration
 * - `off`: the user did not allow notifications
 * - `on`: this device is registered for push
 * - `pending`: not decided yet (signing in, registering)
 */
export type PushStatus = 'unavailable' | 'off' | 'on' | 'pending';

export const PushStatusContext = createContext<PushStatus>('pending');

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeStatusContext);
}

export function usePushStatus(): PushStatus {
  return useContext(PushStatusContext);
}
