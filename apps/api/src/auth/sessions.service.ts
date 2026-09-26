import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type {
  Session,
  SessionRevocationReason,
  User,
} from '../generated/prisma/client.js';

export type SessionWithUser = Session & { user: User };

/** Longest User-Agent kept; matches the column size. */
const USER_AGENT_MAX_LENGTH = 255;

/**
 * Owns the `sessions` table: one row per signed-in device. Every state change is a single
 * conditional UPDATE, so concurrent requests cannot both succeed where only one should.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent: string | undefined;
  }): Promise<Session> {
    return this.prisma.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      },
    });
  }

  findWithUser(id: string): Promise<SessionWithUser | null> {
    return this.prisma.session.findUnique({
      where: { id },
      include: { user: true },
    });
  }

  /**
   * Compare-and-swap rotation: replaces the refresh token hash only if it is still the one
   * the caller validated and the session is still active. Returns false when another request
   * rotated (or revoked) the session first.
   */
  async rotate(input: {
    id: string;
    expectedHash: string;
    nextHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: {
        id: input.id,
        refreshTokenHash: input.expectedHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: input.nextHash,
        expiresAt: input.expiresAt,
        lastUsedAt: input.now,
      },
    });
    return count === 1;
  }

  /** Revokes one session. Idempotent: returns false if it was already revoked. */
  async revoke(
    id: string,
    reason: SessionRevocationReason,
    now: Date = new Date(),
  ): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return count === 1;
  }

  /**
   * Revokes every active session of a user. Prepared for POST /auth/logout-all and account
   * deactivation; uses the user_id index. Returns the number of sessions revoked.
   */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date = new Date(),
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return count;
  }
}
