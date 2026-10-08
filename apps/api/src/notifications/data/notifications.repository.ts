import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import type { Notification } from '../../generated/prisma/client.js';
import type { PlannedNotification } from '../domain/notification-plan.js';

export interface NotificationCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * Owns `notifications` (the inbox) and `push_devices` (FCM registrations): the only code that
 * queries them.
 */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createMany(plans: readonly PlannedNotification[]): Promise<Notification[]> {
    return this.prisma.notification.createManyAndReturn({
      data: plans.map(plan => ({ ...plan })),
    });
  }

  /** A user's inbox, newest first, keyset-paginated on (createdAt, id). */
  async list(
    userId: string,
    limit: number,
    cursor?: NotificationCursor,
  ): Promise<{ items: Notification[]; hasMore: boolean }> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(cursor !== undefined && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks one of the user's notifications read. False if it is not theirs (or unknown). */
  async markRead(userId: string, id: string, now: Date): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (found === null) {
      return false;
    }
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: now },
    });
    return true;
  }

  async markAllRead(userId: string, now: Date): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
  }

  /**
   * Registers the session's FCM token, replacing its previous token (tokens rotate). If the
   * same token is registered on another session (the phone was signed in by someone else
   * before, or signed in again), that registration moves here: a device belongs to whoever
   * is signed in on it now.
   */
  async registerDevice(
    sessionId: string,
    userId: string,
    token: string,
  ): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.pushDevice.deleteMany({
        where: { token, NOT: { sessionId } },
      });
      await tx.pushDevice.upsert({
        where: { sessionId },
        create: { sessionId, userId, token },
        update: { token, userId },
      });
    });
  }

  async removeDeviceOfSession(sessionId: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { sessionId } });
  }

  async removeDeviceByToken(token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token } });
  }

  /**
   * The user's devices whose session is still usable: revoked or expired sessions never
   * receive a push, even if their registration was not removed yet.
   */
  async activeDeviceIds(userId: string, now: Date): Promise<string[]> {
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        userId,
        session: { revokedAt: null, expiresAt: { gt: now } },
      },
      select: { id: true },
    });
    return devices.map(device => device.id);
  }

  /**
   * What a queued push needs, read when it is sent rather than when it was queued: the
   * device's current token (tokens rotate). Null when the push must not be sent any more:
   * the notification or the registration is gone, the session ended, or the device now
   * belongs to someone else (signed in by another user since).
   */
  async pushTarget(
    notificationId: string,
    deviceId: string,
    now: Date,
  ): Promise<{ token: string; notification: Notification } | null> {
    const [notification, device] = await Promise.all([
      this.prisma.notification.findUnique({ where: { id: notificationId } }),
      this.prisma.pushDevice.findFirst({
        where: {
          id: deviceId,
          session: { revokedAt: null, expiresAt: { gt: now } },
        },
        select: { token: true, userId: true },
      }),
    ]);
    if (
      notification === null ||
      device === null ||
      device.userId !== notification.userId
    ) {
      return null;
    }
    return { token: device.token, notification };
  }
}
