import { formatMoney } from '@fieldops/shared/money';
import type { JobType } from '@fieldops/types';

import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
  PaymentOverdueEvent,
} from '../../events/domain-events.js';
import { Role } from '../../users/role.js';
import { NotificationType } from '../notification-enums.js';

/**
 * Which business events become notifications, for whom, and with what words. Pure, so the
 * rules are unit-tested (docs/notifications.md, "Notification types").
 *
 * Only events a person must act on or know about notify:
 * - the worker: an assignment, losing an operation, a new time, a cancellation, a
 *   rejected submission, a verified one;
 * - the responsible manager: a submission waiting for verification, a declined or failed
 *   operation, a basic job completed;
 * - a message goes to the other side of the conversation;
 * - an overdue payment goes to the shop's managers and the organization's admins.
 * Nobody is notified of their own action, and routine steps (accepted, on the way, arrived,
 * started, notes, photos, edits) reach screens through realtime and sync only.
 */

export interface PlannedNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly jobId: string | null;
  readonly shopId: string | null;
  /** Inbox text. The inbox is behind authentication, so it may name the shop. */
  readonly title: string;
  readonly body: string;
}

/** Inbox body length limit (the column is VARCHAR(300)). */
const BODY_MAX = 300;

const clip = (text: string): string =>
  text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX - 1)}…`;

const quoted = (title: string): string => `“${title}”`;

/** "payment collection", "delivery"... for sentences. */
const TYPE_NOUNS: Readonly<Record<JobType, string>> = {
  GENERAL: 'job',
  DELIVERY: 'delivery',
  PAYMENT_COLLECTION: 'payment collection',
  SHOP_VISIT: 'shop visit',
  ORDER_COLLECTION: 'order collection',
  INVENTORY_CHECK: 'inventory check',
};

export const TITLES: Readonly<Record<NotificationType, string>> = {
  JOB_ASSIGNED: 'New operation assigned',
  JOB_UNASSIGNED: 'Operation reassigned',
  JOB_CANCELLED: 'Operation cancelled',
  JOB_COMPLETED: 'Operation completed',
  JOB_MESSAGE: 'New message',
  JOB_RESCHEDULED: 'Operation rescheduled',
  JOB_DECLINED: 'Operation declined',
  JOB_SUBMITTED: 'Needs verification',
  JOB_REJECTED: 'Submission sent back',
  JOB_FAILED: 'Operation failed',
  PAYMENT_OVERDUE: 'Overdue payment',
};

/** "for Nike Chandigarh" when the operation is at a shop, else the job's title. */
function subject(event: JobChangedEvent): string {
  return event.shopName === null
    ? quoted(event.jobTitle)
    : `${TYPE_NOUNS[event.jobType]} for ${event.shopName}`;
}

function money(event: JobChangedEvent): string | null {
  return event.amount === null
    ? null
    : formatMoney(event.amount, event.currency);
}

export function planForJobChange(
  event: JobChangedEvent,
): PlannedNotification[] {
  const plans: PlannedNotification[] = [];
  const add = (
    userId: string | null,
    type: NotificationType,
    body: string,
    title: string = TITLES[type],
  ) => {
    if (userId !== null && userId !== event.actorId) {
      plans.push({
        userId,
        type,
        jobId: event.jobId,
        shopId: event.shopId,
        title,
        body: clip(body),
      });
    }
  };
  const what = subject(event);
  const reason = event.reason === null ? '' : ` Reason: ${event.reason}`;

  switch (event.change) {
    case 'assigned':
      add(
        event.assignedWorkerId,
        NotificationType.JOB_ASSIGNED,
        event.jobType === 'PAYMENT_COLLECTION' && money(event) !== null
          ? `You have been assigned a payment collection of ${money(event)} for ${event.shopName ?? quoted(event.jobTitle)}.`
          : event.shopName === null
            ? quoted(event.jobTitle)
            : `You have been assigned a ${what}.`,
      );
      if (event.previousAssigneeId !== event.assignedWorkerId) {
        add(
          event.previousAssigneeId,
          NotificationType.JOB_UNASSIGNED,
          `The ${what} is no longer assigned to you.`,
        );
      }
      break;
    case 'rescheduled':
      add(
        event.assignedWorkerId,
        NotificationType.JOB_RESCHEDULED,
        `Your ${what} has been rescheduled.${reason}`,
      );
      break;
    case 'cancelled':
      add(
        event.assignedWorkerId,
        NotificationType.JOB_CANCELLED,
        `The ${what} was cancelled.${reason}`,
      );
      break;
    case 'declined':
      add(
        event.managerId,
        NotificationType.JOB_DECLINED,
        `${event.actorName} declined the ${what}.${reason}`,
      );
      break;
    case 'submitted':
      add(
        event.managerId,
        NotificationType.JOB_SUBMITTED,
        event.jobType === 'PAYMENT_COLLECTION' && money(event) !== null
          ? `${event.actorName} submitted a ${money(event)} collection from ${event.shopName ?? quoted(event.jobTitle)}.`
          : `${event.actorName} submitted the ${what}.`,
        event.jobType === 'PAYMENT_COLLECTION'
          ? 'Payment collection requires verification'
          : TITLES.JOB_SUBMITTED,
      );
      break;
    case 'verified':
      add(
        event.assignedWorkerId,
        NotificationType.JOB_COMPLETED,
        `Your ${what} was verified.`,
      );
      break;
    case 'rejected':
      add(
        event.assignedWorkerId,
        NotificationType.JOB_REJECTED,
        `Your ${what} was sent back.${reason}`,
      );
      break;
    case 'failed':
      add(
        event.managerId,
        NotificationType.JOB_FAILED,
        `${event.actorName} could not complete the ${what}.${reason}`,
      );
      break;
    case 'completed':
      // The basic lifecycle: the worker completed a job; its manager is told.
      add(
        event.managerId,
        NotificationType.JOB_COMPLETED,
        quoted(event.jobTitle),
      );
      break;
    case 'updated':
    case 'accepted':
    case 'departed':
    case 'arrived':
    case 'started':
    case 'note':
    case 'evidence':
      break;
  }
  return plans;
}

/**
 * A worker's message goes to the operation's responsible manager; a manager's (or admin's)
 * to the assigned worker. Never back to the author.
 */
export function planForMessage(
  event: JobMessageCreatedEvent,
): PlannedNotification[] {
  const recipient =
    event.authorRole === Role.WORKER ? event.managerId : event.assignedWorkerId;
  if (recipient === null || recipient === event.authorId) {
    return [];
  }
  return [
    {
      userId: recipient,
      type: NotificationType.JOB_MESSAGE,
      jobId: event.jobId,
      shopId: null,
      title: TITLES.JOB_MESSAGE,
      body: clip(quoted(event.jobTitle)),
    },
  ];
}

export function planForOverdue(
  event: PaymentOverdueEvent,
): PlannedNotification[] {
  const body = clip(
    `${event.shopName} has an overdue payment of ${formatMoney(event.outstanding, event.currency)} (${event.orderNumber}).`,
  );
  return event.recipientIds.map(userId => ({
    userId,
    type: NotificationType.PAYMENT_OVERDUE,
    jobId: null,
    shopId: event.shopId,
    title: TITLES.PAYMENT_OVERDUE,
    body,
  }));
}

/**
 * What the push itself says. Deliberately generic: push payloads pass through Google's
 * servers and appear on lock screens, so they carry the notification type and IDs only,
 * never a shop name, amount, customer or address. The app loads the details after the tap.
 */
export function pushText(type: NotificationType): {
  title: string;
  body: string;
} {
  return { title: TITLES[type], body: 'Open FieldOps to see the details.' };
}
