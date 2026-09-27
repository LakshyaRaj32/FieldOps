import type { DeviceLocation } from '@fieldops/types';

/**
 * The outcome of asking for the worker's position, as data rather than exceptions, so every
 * screen handles every case (docs/location.md, "Failure cases"). Pure, and unit-tested.
 */
export type LocationResult =
  | { readonly kind: 'ok'; readonly location: DeviceLocation }
  /** Not granted yet, or refused this time: asking again is possible. */
  | { readonly kind: 'permission_denied' }
  /** Refused with "Don't ask again": only the app's settings screen can change it. */
  | { readonly kind: 'permission_blocked' }
  /** Location is switched off in Android settings. */
  | { readonly kind: 'services_disabled' }
  /** No fix arrived in time (indoors, underground). */
  | { readonly kind: 'timeout' }
  /** No provider, no native module (tests), or an unexpected failure. */
  | { readonly kind: 'unavailable' };

export type LocationFailure = Exclude<LocationResult, { kind: 'ok' }>['kind'];

/** Maps a rejection code of the native module (FieldOpsLocationModule.kt). */
export function failureFromNativeCode(code: unknown): LocationResult {
  switch (code) {
    case 'PERMISSION_DENIED':
      return { kind: 'permission_denied' };
    case 'SERVICES_DISABLED':
      return { kind: 'services_disabled' };
    case 'TIMEOUT':
      return { kind: 'timeout' };
    default:
      return { kind: 'unavailable' };
  }
}

/** A native fix as the API's DeviceLocation, or null if it is not usable. */
export function toDeviceLocation(fix: {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly timestamp: number;
}): DeviceLocation | null {
  const { latitude, longitude, accuracyMeters, timestamp } = fix;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0 ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    // The API accepts up to 100 km; a worse "fix" is not a location.
    accuracyMeters: Math.min(accuracyMeters, 100_000),
    capturedAt: new Date(timestamp).toISOString(),
  };
}

/** What the worker is told, with the action that can fix it. */
export function describeLocationFailure(kind: LocationFailure): {
  readonly message: string;
  readonly action: 'request' | 'settings' | 'location_settings' | 'retry';
} {
  switch (kind) {
    case 'permission_denied':
      return {
        message:
          'FieldOps records where you start and finish a job, and shows your distance to the site. Allow location access to use this.',
        action: 'request',
      };
    case 'permission_blocked':
      return {
        message:
          'Location access is turned off for FieldOps. Turn it on in the app settings to record where you start and finish jobs.',
        action: 'settings',
      };
    case 'services_disabled':
      return {
        message:
          'Location is switched off on this phone. Turn it on to record where you work.',
        action: 'location_settings',
      };
    case 'timeout':
      return {
        message:
          "Couldn't get your position in time. Move to an open area or near a window and try again.",
        action: 'retry',
      };
    case 'unavailable':
      return {
        message: 'Your position is not available on this phone right now.',
        action: 'retry',
      };
  }
}
