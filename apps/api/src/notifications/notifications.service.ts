import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { AppException } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { DomainEvents } from '../events/domain-events.js';
import {
  NotificationsRepository,
  type NotificationCursor,
} from './data/notifications.repository.js';
import {
  planForJobChange,
  planForMessage,
  planForOverdue,
  pushText,
  type PlannedNotification,
} from './domain/notification-plan.js';
import {
  NotificationDto,
  NotificationPageDto,
} from './dto/notification.dto.js';
import { PUSH_SENDER, type PushSender } from './push/push-sender.js';

const DEFAULT_PAGE_SIZE = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Notification orchestration (docs/notifications.md): turns domain events into inbox entries
 * and push messages, and manages push registrations.
 *
 * 1. A job or message event arrives (after its transaction committed).
 * 2. The plan decides who is told what (domain/notification-plan.ts).
 * 3. The inbox rows are written: the durable record the app lists.
 * 4. A push goes to each recipient's active devices; FCM's "unregistered" answer removes
 *    the registration. Push failures are logged, never retried before Phase 5 (BullMQ):
 *    the inbox, realtime and sync already carry the information.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly subscriptions: (() => void)[] = [];

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly events: DomainEvents,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.events.subscribe('job.changed', event =>
        this.deliver(planForJobChange(event)),
      ),
      this.events.subscribe('job.message.created', event =>
        this.deliver(planForMessage(event)),
      ),
      this.events.subscribe('payment.overdue', event =>
        this.deliver(planForOverdue(event)),
      ),
      this.events.subscribe('session.ended', event =>
        this.notifications.removeDeviceOfSession(event.sessionId),
      ),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
  }

  /** Records the plans in the inboxes, then pushes each one. Resolves when all are tried. */
  async deliver(plans: readonly PlannedNotification[]): Promise<void> {
    if (plans.length === 0) {
      return;
    }
    const created = await this.notifications.createMany(plans);
    for (const notification of created) {
      const tokens = await this.notifications.activeTokens(
        notification.userId,
        new Date(),
      );
      for (const token of tokens) {
        const result = await this.push.send(token, {
          ...pushText(notification.type),
          data: {
            type: notification.type,
            jobId: notification.jobId ?? '',
            shopId: notification.shopId ?? '',
            notificationId: notification.id,
          },
        });
        if (result === 'invalid_token') {
          await this.notifications.removeDeviceByToken(token);
          this.logger.log(
            `Removed an expired push registration (userId=${notification.userId})`,
          );
        } else if (result === 'failed') {
          this.logger.warn(
            `Push delivery failed (notificationId=${notification.id})`,
          );
        }
      }
    }
  }

  async list(
    user: AuthenticatedUser,
    limit = DEFAULT_PAGE_SIZE,
    cursorValue?: string,
  ): Promise<NotificationPageDto> {
    let cursor: NotificationCursor | undefined;
    if (cursorValue !== undefined) {
      cursor = decodeCursor(cursorValue);
      if (cursor === undefined) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          'Some fields are missing or invalid.',
          [{ field: 'cursor', message: 'Cursor is invalid.' }],
        );
      }
    }
    const [{ items, hasMore }, unreadCount] = await Promise.all([
      this.notifications.list(user.userId, limit, cursor),
      this.notifications.unreadCount(user.userId),
    ]);
    const last = items.at(-1);
    return Object.assign(new NotificationPageDto(), {
      items: items.map(row => NotificationDto.from(row)),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      unreadCount,
    });
  }

  async markRead(user: AuthenticatedUser, id: string): Promise<void> {
    if (!(await this.notifications.markRead(user.userId, id, new Date()))) {
      // Someone else's notification is reported exactly like a missing one.
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Notification not found.',
      );
    }
  }

  markAllRead(user: AuthenticatedUser): Promise<void> {
    return this.notifications.markAllRead(user.userId, new Date());
  }

  /** This device (session) receives pushes at `token` from now on. */
  registerDevice(user: AuthenticatedUser, token: string): Promise<void> {
    return this.notifications.registerDevice(
      user.sessionId,
      user.userId,
      token,
    );
  }

  /** This device (session) stops receiving pushes. Idempotent. */
  unregisterDevice(user: AuthenticatedUser): Promise<void> {
    return this.notifications.removeDeviceOfSession(user.sessionId);
  }
}

function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
  ).toString('base64url');
}

function decodeCursor(value: string): NotificationCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return undefined;
    }
    const [createdAt, id] = parsed as unknown[];
    if (typeof createdAt !== 'string' || typeof id !== 'string') {
      return undefined;
    }
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) || !UUID.test(id)
      ? undefined
      : { createdAt: date, id };
  } catch {
    return undefined;
  }
}
