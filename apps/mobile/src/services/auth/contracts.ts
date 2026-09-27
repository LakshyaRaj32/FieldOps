import {
  Role,
  type AuthResult,
  type AuthTokens,
  type UserProfile,
} from '@fieldops/types';

/**
 * Runtime checks for the auth payloads the app receives or restores from storage.
 * TypeScript types are erased at runtime, so data crossing a boundary (network, disk) is
 * checked before the app trusts it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function allStrings(...values: readonly unknown[]): boolean {
  return values.every(value => typeof value === 'string');
}

const ROLES: readonly unknown[] = Object.values(Role);

function isOrganizationSummary(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const { id, name, status, currency, timeZone } = value;
  return (
    allStrings(id, name, currency, timeZone) &&
    (status === 'ACTIVE' || status === 'SUSPENDED')
  );
}

export function isUserProfile(value: unknown): value is UserProfile {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    email,
    firstName,
    lastName,
    createdAt,
    role,
    isActive,
    organization,
    organizationWideAccess,
  } = value;
  return (
    allStrings(id, email, firstName, lastName, createdAt) &&
    ROLES.includes(role) &&
    typeof isActive === 'boolean' &&
    isOrganizationSummary(organization) &&
    typeof organizationWideAccess === 'boolean'
  );
}

/**
 * A profile stored by an app version before organizations existed has no organization
 * fields. Reading it as "no organization yet" keeps the session; the next /auth/me (or
 * sign-in) stores the real ones.
 */
export function upgradeStoredProfile(value: unknown): unknown {
  return isRecord(value)
    ? { organization: null, organizationWideAccess: false, ...value }
    : value;
}

export function isAuthTokens(value: unknown): value is AuthTokens {
  if (!isRecord(value)) {
    return false;
  }
  const {
    tokenType,
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
  } = value;
  return (
    tokenType === 'Bearer' &&
    allStrings(
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    )
  );
}

export function isAuthResult(value: unknown): value is AuthResult {
  if (!isRecord(value)) {
    return false;
  }
  const { user, tokens } = value;
  return isUserProfile(user) && isAuthTokens(tokens);
}
