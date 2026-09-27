/**
 * Small runtime type guards for API payloads. TypeScript types are erased at runtime, so data
 * crossing the network boundary is checked before screens trust it; a payload of the wrong
 * shape becomes an ordinary failed request (see fetchChecked in the feature APIs).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const isString = (value: unknown): value is string =>
  typeof value === 'string';

export const isNullableString = (value: unknown): boolean =>
  value === null || isString(value);

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isNullableNumber = (value: unknown): boolean =>
  value === null || isNumber(value);

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

export const isArrayOf = (
  value: unknown,
  guard: (item: unknown) => boolean,
): boolean => Array.isArray(value) && value.every(guard);

/** A guard for one of the string values of a vocabulary object (`as const`). */
export const oneOf =
  (vocabulary: Readonly<Record<string, string>>) =>
  (value: unknown): boolean =>
    Object.values(vocabulary).includes(value as string);

export function isUserSummary(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { id, firstName, lastName } = value;
  return [id, firstName, lastName].every(isString);
}

export const isNullableUser = (value: unknown): boolean =>
  value === null || isUserSummary(value);

export function isGeoPoint(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return isNumber(value['latitude']) && isNumber(value['longitude']);
}

export const isNullableGeoPoint = (value: unknown): boolean =>
  value === null || isGeoPoint(value);
