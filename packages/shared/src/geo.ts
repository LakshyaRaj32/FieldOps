/**
 * Distances between WGS 84 coordinates. The API uses it to compute, from the fix a worker's
 * phone reported, how far from the job site a job was started or completed; the phone uses
 * the same function to show its own estimate before the server has answered.
 *
 * Deterministic and dependency-free (no I/O), so both runtimes get identical results.
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Mean Earth radius (IUGG), in meters. */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Whether the value is a finite latitude/longitude pair within WGS 84 bounds. */
export function isValidCoordinates(value: Coordinates): boolean {
  const { latitude, longitude } = value;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Great-circle distance in meters (haversine formula on a sphere). The spherical model is
 * off by at most about 0.5% against the WGS 84 ellipsoid, far below the error of a phone's
 * GPS fix, which is what this distance is compared with.
 *
 * @throws RangeError for coordinates outside WGS 84 bounds (or not finite).
 */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
    throw new RangeError('Coordinates must be finite WGS 84 degrees');
  }
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  // min() guards against rounding just above 1 for antipodal points.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
