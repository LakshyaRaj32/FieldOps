/**
 * Authentication contracts shared by the API (which implements them in its DTO classes)
 * and the mobile app (which consumes them). See docs/authentication.md.
 */

import type { OrganizationSummary } from './organizations';
import type { Role } from './role';

/** The public view of a user. Never contains the password hash. */
export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
  readonly isActive: boolean;
  /** The organization the user belongs to; null for SUPER_ADMIN and unaffiliated accounts. */
  readonly organization: OrganizationSummary | null;
  /** MANAGER: sees every team, shop and operation of the organization. */
  readonly organizationWideAccess: boolean;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

export interface AuthTokens {
  readonly tokenType: 'Bearer';
  /** Short-lived JWT, sent as `Authorization: Bearer <token>`. */
  readonly accessToken: string;
  /** ISO 8601 timestamp. */
  readonly accessTokenExpiresAt: string;
  /** Long-lived, single-use token for POST /auth/refresh. Store it securely. */
  readonly refreshToken: string;
  /** ISO 8601 timestamp. */
  readonly refreshTokenExpiresAt: string;
}

/** Returned by register and login. */
export interface AuthResult {
  readonly user: UserProfile;
  readonly tokens: AuthTokens;
}

export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface RefreshTokenRequest {
  readonly refreshToken: string;
}
