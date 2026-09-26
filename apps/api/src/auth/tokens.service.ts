import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { Role } from '../users/role.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  REFRESH_TOKEN_AUDIENCE,
  TOKEN_ALGORITHM,
  TOKEN_ISSUER,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from './types/jwt-payload.js';

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface IssuedRefreshToken extends IssuedToken {
  /** What the database stores instead of the token itself. */
  readonly hash: string;
}

/**
 * Issues and verifies FieldOps tokens with @nestjs/jwt (jsonwebtoken). This service does no
 * cryptography of its own beyond calling Node's SHA-256 and constant-time comparison.
 *
 * Access tokens are verified by JwtStrategy (passport-jwt) with the same issuer, audience
 * and algorithm settings used here.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issueAccessToken(
    claims: { userId: string; sessionId: string; role: Role },
    now: Date = new Date(),
  ): IssuedToken {
    const { accessTokenSecret, accessTokenTtlSeconds } = this.config.auth;
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAt + accessTokenTtlSeconds;
    const payload: AccessTokenPayload & { iat: number; exp: number } = {
      sub: claims.userId,
      sid: claims.sessionId,
      role: claims.role,
      iat: issuedAt,
      exp: expiresAtSeconds,
    };
    const token = this.jwt.sign(payload, {
      secret: accessTokenSecret,
      algorithm: TOKEN_ALGORITHM,
      issuer: TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  /**
   * A refresh token is a signed JWT naming its session, plus a random `jti` so that every
   * rotation produces a different token. Its expiry equals the session's expiry.
   */
  issueRefreshToken(
    claims: { userId: string; sessionId: string },
    expiresAt: Date,
    now: Date = new Date(),
  ): IssuedRefreshToken {
    const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
    const payload: RefreshTokenPayload & { iat: number; exp: number } = {
      sub: claims.userId,
      sid: claims.sessionId,
      jti: randomUUID(),
      iat: Math.floor(now.getTime() / 1000),
      exp: expiresAtSeconds,
    };
    const token = this.jwt.sign(payload, {
      secret: this.config.auth.refreshTokenSecret,
      algorithm: TOKEN_ALGORITHM,
      issuer: TOKEN_ISSUER,
      audience: REFRESH_TOKEN_AUDIENCE,
    });
    return {
      token,
      expiresAt: new Date(expiresAtSeconds * 1000),
      hash: TokensService.hashRefreshToken(token),
    };
  }

  /**
   * Returns the payload of a genuine, unexpired refresh token, or undefined for anything
   * else (bad signature, wrong audience, expired, malformed). Session checks come after.
   */
  verifyRefreshToken(token: string): RefreshTokenPayload | undefined {
    try {
      const payload = this.jwt.verify<Partial<RefreshTokenPayload>>(token, {
        secret: this.config.auth.refreshTokenSecret,
        algorithms: [TOKEN_ALGORITHM],
        issuer: TOKEN_ISSUER,
        audience: REFRESH_TOKEN_AUDIENCE,
      });
      const { sub, sid, jti } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof jti !== 'string'
      ) {
        return undefined;
      }
      return { sub, sid, jti };
    } catch {
      return undefined;
    }
  }

  /**
   * SHA-256, not a password hash: the token is already high-entropy random data, so a slow
   * hash adds nothing, and bcrypt would silently truncate a JWT at 72 bytes.
   */
  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant-time comparison of a presented token against the stored hash. */
  static refreshTokenMatches(token: string, storedHash: string): boolean {
    const presented = Buffer.from(TokensService.hashRefreshToken(token), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return (
      presented.length === stored.length && timingSafeEqual(presented, stored)
    );
  }
}
