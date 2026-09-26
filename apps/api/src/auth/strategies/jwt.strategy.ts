import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AuthErrors } from '../../common/errors/app-exception.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { SessionsService } from '../sessions.service.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  TOKEN_ALGORITHM,
  TOKEN_ISSUER,
  type AccessTokenPayload,
} from '../types/jwt-payload.js';

export const JWT_STRATEGY = 'jwt';

/**
 * Verifies `Authorization: Bearer <access token>` with passport-jwt (signature, expiry,
 * issuer, audience, HS256 only), then checks the token's session in the database.
 *
 * The session check costs one primary-key lookup per request. In exchange, logout,
 * reuse-triggered revocation and account deactivation take effect immediately instead of
 * after up to one access-token lifetime, and the role comes from the database rather than
 * from a possibly stale token. Redis caching of this lookup is a V10 option.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.auth.accessTokenSecret,
      algorithms: [TOKEN_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      ignoreExpiration: false,
    });
  }

  async validate(
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

    return {
      userId: session.userId,
      sessionId: session.id,
      role: session.user.role,
    };
  }
}
