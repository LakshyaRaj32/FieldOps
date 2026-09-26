import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { AuthErrors } from '../common/errors/app-exception.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import {
  SessionRevocationReason,
  type User,
} from '../generated/prisma/client.js';
import { UserProfileDto } from '../users/dto/user-profile.dto.js';
import { UsersService } from '../users/users.service.js';
import type { AuthResultDto, AuthTokensDto } from './dto/auth-response.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

export interface ClientContext {
  readonly userAgent: string | undefined;
}

/**
 * Authentication use cases. See docs/authentication.md for the full flow, the rotation and
 * reuse-detection rules, and the security trade-offs.
 *
 * Log lines here carry IDs only (user ID, session ID), never emails, passwords or tokens.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a WORKER account and signs it in on the calling device. */
  async register(
    dto: RegisterDto,
    client: ClientContext,
  ): Promise<AuthResultDto> {
    const user = await this.users.create({
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    this.logger.log(`User registered (userId=${user.id})`);
    return this.startSession(user, client);
  }

  async login(dto: LoginDto, client: ClientContext): Promise<AuthResultDto> {
    const user = await this.users.findByEmail(dto.email);
    const passwordValid =
      user === null
        ? await this.passwords.verifyAgainstNothing(dto.password)
        : await this.passwords.verify(user.passwordHash, dto.password);

    if (user === null || !passwordValid) {
      // Same error for "no such email" and "wrong password".
      throw AuthErrors.invalidCredentials();
    }
    // Revealed only after a correct password, so it does not help enumerate accounts.
    if (!user.isActive) {
      throw AuthErrors.accountDisabled();
    }

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(
        user.id,
        await this.passwords.hash(dto.password),
      );
    }

    return this.startSession(user, client);
  }

  /**
   * Refresh token rotation with reuse detection.
   *
   * 1. The token must be a genuine, unexpired refresh JWT (signature, issuer, audience).
   * 2. Its session must exist, belong to the token's user, be unrevoked and unexpired, and
   *    its user must be active.
   * 3. The token must be the session's CURRENT token (hash match). A genuine token that is
   *    not current can only be one that was already rotated: someone is replaying it, so
   *    the whole session is revoked (the legitimate device signs in again).
   * 4. The hash is swapped atomically. If another request rotated first, this request
   *    presented a stale token, which is also treated as reuse.
   */
  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const payload = this.tokens.verifyRefreshToken(refreshToken);
    if (payload === undefined) {
      throw AuthErrors.refreshTokenInvalid();
    }

    const session = await this.sessions.findWithUser(payload.sid);
    if (session === null || session.userId !== payload.sub) {
      throw AuthErrors.refreshTokenInvalid();
    }
    if (session.revokedAt !== null) {
      throw AuthErrors.sessionRevoked();
    }
    const now = new Date();
    if (session.expiresAt <= now) {
      throw AuthErrors.sessionExpired();
    }
    if (!session.user.isActive) {
      throw AuthErrors.accountDisabled();
    }

    if (
      !TokensService.refreshTokenMatches(refreshToken, session.refreshTokenHash)
    ) {
      await this.revokeForReuse(session.id);
      throw AuthErrors.refreshTokenReused();
    }

    const expiresAt = this.sessionExpiry(now);
    const next = this.tokens.issueRefreshToken(
      { userId: session.userId, sessionId: session.id },
      expiresAt,
      now,
    );
    const rotated = await this.sessions.rotate({
      id: session.id,
      expectedHash: session.refreshTokenHash,
      nextHash: next.hash,
      expiresAt: next.expiresAt,
      now,
    });
    if (!rotated) {
      await this.revokeForReuse(session.id);
      throw AuthErrors.refreshTokenReused();
    }

    const access = this.tokens.issueAccessToken(
      {
        userId: session.userId,
        sessionId: session.id,
        role: session.user.role,
      },
      now,
    );
    return toTokensDto(access, next);
  }

  /** Revokes the session the access token belongs to. Idempotent. */
  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, SessionRevocationReason.LOGOUT);
    this.logger.log(`Session signed out (sessionId=${sessionId})`);
  }

  /**
   * Revokes every session of the user (all devices). Not exposed over HTTP yet; the endpoint
   * (POST /auth/logout-all) is a one-line controller addition when a client needs it.
   */
  async logoutAll(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(
      userId,
      SessionRevocationReason.LOGOUT_ALL,
    );
  }

  async me(userId: string): Promise<UserProfileDto> {
    const user = await this.users.findById(userId);
    if (user === null) {
      // The guard already verified the session, so this only happens if the user was
      // deleted in between.
      throw AuthErrors.sessionRevoked();
    }
    return UserProfileDto.fromUser(user);
  }

  private async startSession(
    user: User,
    client: ClientContext,
  ): Promise<AuthResultDto> {
    const now = new Date();
    // The session ID is generated here (not by the database) because the refresh token,
    // whose hash the row stores, has to contain it.
    const sessionId = uuidv7();
    const refresh = this.tokens.issueRefreshToken(
      { userId: user.id, sessionId },
      this.sessionExpiry(now),
      now,
    );
    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
      userAgent: client.userAgent,
    });
    const access = this.tokens.issueAccessToken(
      { userId: user.id, sessionId, role: user.role },
      now,
    );
    this.logger.log(
      `Session started (userId=${user.id}, sessionId=${sessionId})`,
    );
    return {
      user: UserProfileDto.fromUser(user),
      tokens: toTokensDto(access, refresh),
    };
  }

  private sessionExpiry(now: Date): Date {
    return new Date(
      now.getTime() + this.config.auth.refreshTokenTtlSeconds * 1000,
    );
  }

  private async revokeForReuse(sessionId: string): Promise<void> {
    await this.sessions.revoke(
      sessionId,
      SessionRevocationReason.REFRESH_TOKEN_REUSE,
    );
    this.logger.warn(
      `Refresh token reuse detected; session revoked (sessionId=${sessionId})`,
    );
  }
}

function toTokensDto(
  access: { token: string; expiresAt: Date },
  refresh: { token: string; expiresAt: Date },
): AuthTokensDto {
  return {
    tokenType: 'Bearer',
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}
