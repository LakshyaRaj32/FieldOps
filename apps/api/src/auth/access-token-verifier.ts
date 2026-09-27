import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthErrors } from '../common/errors/app-exception.js';
import { TenancyErrors } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { SessionsService } from './sessions.service.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  TOKEN_ALGORITHM,
  TOKEN_ISSUER,
  type AccessTokenPayload,
} from './types/jwt-payload.js';

export interface VerifiedAccessToken {
  readonly user: AuthenticatedUser;
  /** When the token stops being valid: open WebSocket connections close then. */
  readonly expiresAt: Date;
}

/**
 * The one definition of "this access token belongs to a usable session", used by the HTTP
 * guard (through JwtStrategy, which checks the JWT itself with passport-jwt) and by the
 * WebSocket gateway (which checks the JWT with `verify`). Both therefore accept exactly the
 * same tokens and apply the same revocation, expiry and deactivation rules.
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Verifies a raw access token: signature, algorithm, issuer, audience and expiry, then
   * its session.
   *
   * @throws AppException (ACCESS_TOKEN_EXPIRED, ACCESS_TOKEN_INVALID, SESSION_REVOKED, ...)
   */
  async verify(token: string): Promise<VerifiedAccessToken> {
    let payload: Partial<AccessTokenPayload> & { exp?: unknown };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.auth.accessTokenSecret,
        algorithms: [TOKEN_ALGORITHM],
        issuer: TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw AuthErrors.accessTokenExpired();
      }
      throw AuthErrors.accessTokenInvalid();
    }
    if (typeof payload.exp !== 'number') {
      throw AuthErrors.accessTokenInvalid();
    }
    const user = await this.principalFor(payload);
    return { user, expiresAt: new Date(payload.exp * 1000) };
  }

  /**
   * The principal for a token whose JWT is already verified: its session must exist, belong
   * to the token's user, be neither revoked nor expired, its user must be active and their
   * organization (if any) not suspended. The role and the organization come from the
   * database, never from the (possibly stale) token.
   */
  async principalFor(
    payload: Partial<AccessTokenPayload>,
  ): Promise<AuthenticatedUser> {
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw AuthErrors.accessTokenInvalid();
    }

    const session = await this.sessions.findWithUser(payload.sid);
    if (session === null || session.userId !== payload.sub) {
      throw AuthErrors.accessTokenInvalid();
    }
    if (session.revokedAt !== null) {
      throw AuthErrors.sessionRevoked();
    }
    if (session.expiresAt <= new Date()) {
      throw AuthErrors.sessionExpired();
    }
    if (!session.user.isActive) {
      throw AuthErrors.accountDisabled();
    }
    if (session.user.organization?.status === 'SUSPENDED') {
      throw TenancyErrors.organizationSuspended();
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      role: session.user.role,
      organizationId: session.user.organizationId,
      organizationWideAccess: session.user.organizationWideAccess,
    };
  }
}
