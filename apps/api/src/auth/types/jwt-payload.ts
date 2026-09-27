import type { Role } from '../../users/role.js';

/** Issuer of every FieldOps token. */
export const TOKEN_ISSUER = 'fieldops-api';

/**
 * Distinct audiences for the two token types. Together with distinct secrets this means an
 * access token can never be accepted as a refresh token or the other way round.
 */
export const ACCESS_TOKEN_AUDIENCE = 'fieldops:access';
export const REFRESH_TOKEN_AUDIENCE = 'fieldops:refresh';

/** Only HS256 is accepted on verification (prevents algorithm-confusion attacks). */
export const TOKEN_ALGORITHM = 'HS256';

/**
 * Access token claims: only what authentication and authorization need. No email, name or
 * other personal data (JWT payloads are only base64-encoded, not encrypted).
 */
export interface AccessTokenPayload {
  /** User ID. */
  readonly sub: string;
  /** Session ID: lets the server reject tokens of revoked sessions. */
  readonly sid: string;
  readonly role: Role;
}

export interface RefreshTokenPayload {
  readonly sub: string;
  readonly sid: string;
  /** Random token ID: makes every rotated token unique. */
  readonly jti: string;
}
