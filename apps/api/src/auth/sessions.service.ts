import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type {
  Organization,
  Session,
  SessionRevocationReason,
  User,
} from '../generated/prisma/client.js';

export type UserWithOrganization = User & {
  organization: Organization | null;
};
export type SessionWithUser = Session & { user: UserWithOrganization };

/** Rows deleted per statement by the purge. */
const PURGE_BATCH = 1_000;

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
      include: { user: { include: { organization: true } } },
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
   * Revokes every active session of a user except `keepSessionId` (a password change keeps
   * the device that made it signed in). Returns the IDs revoked.
   */
  async revokeOthers(
    userId: string,
    keepSessionId: string,
    reason: SessionRevocationReason,
    now: Date = new Date(),
  ): Promise<string[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: keepSessionId } },
      select: { id: true },
    });
    const ids = sessions.map(session => session.id);
    if (ids.length > 0) {
      await this.prisma.session.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
    }
    return ids;
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

  /**
   * Deletes sessions that expired before `expiredBefore` (revoked ones included: they keep
   * their expiry), with their push registrations. Batched, so no single statement holds many
   * row locks. Returns the number deleted.
   */
  async purgeExpired(expiredBefore: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions WHERE expires_at < ${expiredBefore} LIMIT ${PURGE_BATCH}
        )`;
      total += deleted;
      if (deleted < PURGE_BATCH) {
        return total;
      }
    }
  }
}
