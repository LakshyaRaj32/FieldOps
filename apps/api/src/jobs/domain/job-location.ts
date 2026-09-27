import { distanceMeters } from '@fieldops/shared/geo';
import type { DeviceLocation } from '@fieldops/types';

/** Where the worker was, as recorded on a STARTED or COMPLETED history entry. */
export interface EventLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly locatedAt: Date;
  /** From the job site, computed here; null when the job has no coordinates. */
  readonly distanceMeters: number | null;
}

/**
 * The history entry's location for a fix the phone reported: the coordinates as sent, and
 * the distance from the job site computed by the server (a client-sent distance would not
 * be accepted, and none is). Nothing is authorized on it: a fix can be inaccurate or spoofed
 * (docs/location.md, "Trust boundary").
 */
export function eventLocation(
  site: { readonly latitude: number | null; readonly longitude: number | null },
  fix: DeviceLocation,
): EventLocation {
  const distance =
    site.latitude === null || site.longitude === null
      ? null
      : Math.round(
          distanceMeters(
            { latitude: site.latitude, longitude: site.longitude },
            fix,
          ),
        );
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters,
    locatedAt: new Date(fix.capturedAt),
    distanceMeters: distance,
  };
}
