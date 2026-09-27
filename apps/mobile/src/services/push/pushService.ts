import { PermissionsAndroid, Platform } from 'react-native';
import { getApps } from '@react-native-firebase/app';
import {
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  setBackgroundMessageHandler,
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';

import { logger } from '../../utils/logger';

/**
 * Firebase Cloud Messaging on the device (the only importer of @react-native-firebase,
 * enforced by ESLint). See docs/notifications.md.
 *
 * Push is optional: a build without app/google-services.json has no Firebase app, and every
 * function here then reports "unavailable" instead of failing. The inbox, realtime and sync
 * work either way; push only adds reach while the app is in the background or closed.
 *
 * Messages carry IDs only (`PushData`), never job content; the app fetches the details with
 * the user's own credentials after the tap.
 */

export type PushPermission = 'granted' | 'denied' | 'blocked';

export type PushMessageData = Readonly<Record<string, string>>;

export function isPushAvailable(): boolean {
  try {
    return getApps().length > 0;
  } catch {
    return false;
  }
}

/** Android 13+ needs a runtime permission to show notifications; older versions do not. */
export async function requestPushPermission(): Promise<PushPermission> {
  if (Platform.OS !== 'android') {
    return 'denied';
  }
  if (Number(Platform.Version) < 33) {
    return 'granted';
  }
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) {
    return 'granted';
  }
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ? 'blocked'
    : 'denied';
}

/** This installation's FCM registration token, or null when push is unavailable. */
export async function currentPushToken(): Promise<string | null> {
  if (!isPushAvailable()) {
    return null;
  }
  try {
    return await getToken(getMessaging());
  } catch (error) {
    logger.warn('Could not get a push token', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/** Invalidates the token on this device (explicit sign-out); the next user gets a new one. */
export async function discardPushToken(): Promise<void> {
  if (!isPushAvailable()) {
    return;
  }
  try {
    await deleteToken(getMessaging());
  } catch {
    // The server already removed the registration with the session.
  }
}

const dataOf = (
  message: FirebaseMessagingTypes.RemoteMessage | null,
): PushMessageData | null => {
  const data = message?.data;
  if (data === undefined) {
    return null;
  }
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      strings[key] = value;
    }
  }
  return strings;
};

export interface PushHandlers {
  /** FCM rotated the token: register it again. */
  readonly onToken: (token: string) => void;
  /** A message arrived while the app is in the foreground (no system notification). */
  readonly onForegroundMessage: (data: PushMessageData | null) => void;
  /** The user tapped a notification (app in the background, or started by the tap). */
  readonly onOpened: (data: PushMessageData) => void;
}

/** Subscribes to push events; returns the function that unsubscribes. */
export function listenForPush(handlers: PushHandlers): () => void {
  if (!isPushAvailable()) {
    return () => undefined;
  }
  const messaging = getMessaging();
  const unsubscribers = [
    onTokenRefresh(messaging, handlers.onToken),
    onMessage(messaging, async message => {
      handlers.onForegroundMessage(dataOf(message));
    }),
    onNotificationOpenedApp(messaging, message => {
      const data = dataOf(message);
      if (data !== null) {
        handlers.onOpened(data);
      }
    }),
  ];
  // The app was started by tapping a notification (it was not running).
  getInitialNotification(messaging)
    .then(message => {
      const data = dataOf(message);
      if (data !== null) {
        handlers.onOpened(data);
      }
    })
    .catch(() => undefined);
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/**
 * Registered at startup (index.js), before React. Notification messages are displayed by
 * Android itself while the app is in the background; nothing needs to run in JavaScript,
 * because the app resynchronizes when it is next opened. The handler exists so that FCM
 * does not warn about a missing one.
 */
export function registerBackgroundPushHandler(): void {
  if (!isPushAvailable()) {
    return;
  }
  setBackgroundMessageHandler(getMessaging(), async () => undefined);
}
