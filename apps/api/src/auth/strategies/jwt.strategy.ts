import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AccessTokenVerifier } from '../access-token-verifier.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  TOKEN_ALGORITHM,
  TOKEN_ISSUER,
  type AccessTokenPayload,
} from '../types/jwt-payload.js';

export const JWT_STRATEGY = 'jwt';

/**
 * Verifies `Authorization: Bearer <access token>` with passport-jwt (signature, expiry,
 * issuer, audience, HS256 only), then checks the token's session in the database
 * (AccessTokenVerifier.principalFor, shared with the WebSocket gateway).
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
    private readonly verifier: AccessTokenVerifier,
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

  validate(payload: Partial<AccessTokenPayload>): Promise<AuthenticatedUser> {
    return this.verifier.principalFor(payload);
  }
}
