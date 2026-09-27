import { Linking, PermissionsAndroid, Platform } from 'react-native';

import NativeFieldOpsLocation from '../native/NativeFieldOpsLocation';
import {
  failureFromNativeCode,
  toDeviceLocation,
  type LocationResult,
} from './locationResult';

/**
 * The worker's position, on demand and in the foreground only (docs/location.md). Nothing
 * here tracks, stores or uploads anything: callers decide what a fix is used for (a job
 * command records it through the outbox; the distance card shows it and forgets it).
 *
 * The only code that talks to the native location module and the location permission.
 */

/** A fix Android already has is fine if it is this recent (saves battery and time). */
const MAXIMUM_AGE_MS = 2 * 60_000;
/** How long a command waits for a fresh fix before going ahead without one. */
const TIMEOUT_MS = 15_000;

const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

export type LocationPermission = 'granted' | 'denied' | 'blocked';

/** Whether FieldOps may use location now (precise or approximate). Never prompts. */
export async function locationPermission(): Promise<'granted' | 'denied'> {
  if (Platform.OS !== 'android') {
    return 'denied';
  }
  const [fine, coarse] = await Promise.all([
    PermissionsAndroid.check(FINE),
    PermissionsAndroid.check(COARSE),
  ]);
  return fine || coarse ? 'granted' : 'denied';
}

/**
 * Shows the system prompt (Android 12+ lets the worker choose precise or approximate). Call
 * it in context, right after explaining why, never at app start.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (Platform.OS !== 'android') {
    return 'denied';
  }
  const result = await PermissionsAndroid.requestMultiple([FINE, COARSE]);
  const values = [result[FINE], result[COARSE]];
  if (values.includes(PermissionsAndroid.RESULTS.GRANTED)) {
    return 'granted';
  }
  return values.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
    ? 'blocked'
    : 'denied';
}

/**
 * One position fix. With `request`, a missing permission is asked for first; otherwise it
 * is reported as `permission_denied`.
 */
export async function getCurrentLocation({
  request = false,
  timeoutMs = TIMEOUT_MS,
}: {
  readonly request?: boolean;
  readonly timeoutMs?: number;
} = {}): Promise<LocationResult> {
  if (NativeFieldOpsLocation == null) {
    return { kind: 'unavailable' };
  }
  let permission: LocationPermission = await locationPermission();
  if (permission !== 'granted' && request) {
    permission = await requestLocationPermission();
  }
  if (permission === 'blocked') {
    return { kind: 'permission_blocked' };
  }
  if (permission !== 'granted') {
    return { kind: 'permission_denied' };
  }
  if (!NativeFieldOpsLocation.isLocationEnabled()) {
    return { kind: 'services_disabled' };
  }
  try {
    const fix = await NativeFieldOpsLocation.getCurrentPosition(
      timeoutMs,
      MAXIMUM_AGE_MS,
    );
    const location = toDeviceLocation(fix);
    return location === null
      ? { kind: 'unavailable' }
      : { kind: 'ok', location };
  } catch (error) {
    return failureFromNativeCode((error as { code?: unknown } | null)?.code);
  }
}

export function openLocationSettings(): void {
  NativeFieldOpsLocation?.openLocationSettings();
}

/** The app's own settings page (to re-enable a permission refused for good). */
export function openAppSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

/** Opens the job site in the phone's maps app (no map SDK in the app). */
export function openInMaps(
  point: { readonly latitude: number; readonly longitude: number },
  label: string,
): void {
  const coordinates = `${point.latitude},${point.longitude}`;
  Linking.openURL(
    `geo:${coordinates}?q=${coordinates}(${encodeURIComponent(label)})`,
  ).catch(() => undefined);
}
