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

export function isUserProfile(value: unknown): value is UserProfile {
  if (!isRecord(value)) {
    return false;
  }
  const { id, email, firstName, lastName, createdAt, role, isActive } = value;
  return (
    allStrings(id, email, firstName, lastName, createdAt) &&
    ROLES.includes(role) &&
    typeof isActive === 'boolean'
  );
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
