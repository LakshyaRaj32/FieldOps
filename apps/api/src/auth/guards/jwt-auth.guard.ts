import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { AppException, AuthErrors } from '../../common/errors/app-exception.js';
import { JWT_STRATEGY } from '../strategies/jwt.strategy.js';

/**
 * Global authentication guard: every route requires a valid access token unless it is
 * marked @Public(). Failures are mapped to precise error codes so the client knows whether
 * to refresh (ACCESS_TOKEN_EXPIRED) or to sign the user out.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) {
      return true;
    }
    return super.canActivate(context);
  }

  override handleRequest<TUser>(
    error: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    // Thrown by JwtStrategy.validate (revoked session, disabled account...).
    if (error instanceof AppException) {
      throw error;
    }
    if (error !== null && error !== undefined) {
      throw AuthErrors.accessTokenInvalid();
    }
    if (user !== false && user !== null && user !== undefined) {
      return user;
    }
    // Matched by name: passport-jwt may resolve its own copy of jsonwebtoken, which would
    // make an instanceof check against @nestjs/jwt's TokenExpiredError fail.
    if (info instanceof Error && info.name === 'TokenExpiredError') {
      throw AuthErrors.accessTokenExpired();
    }
    // passport-jwt reports a missing header as an Error whose message is "No auth token".
    if (info instanceof Error && info.message === 'No auth token') {
      throw AuthErrors.unauthenticated();
    }
    throw AuthErrors.accessTokenInvalid();
  }
}
