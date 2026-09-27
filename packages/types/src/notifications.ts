/**
 * In-app notifications and push registration. See docs/notifications.md.
 *
 * Every notification comes from a business event (an assignment, a submission, an overdue
 * payment), never from the UI.
 */

export const NotificationType = {
  /** An operation was assigned to you. */
  JOB_ASSIGNED: 'JOB_ASSIGNED',
  /** An operation you had was reassigned to someone else. */
  JOB_UNASSIGNED: 'JOB_UNASSIGNED',
  /** An operation assigned to you was cancelled. */
  JOB_CANCELLED: 'JOB_CANCELLED',
  /** An operation you are responsible for was completed (basic lifecycle), or yours was verified. */
  JOB_COMPLETED: 'JOB_COMPLETED',
  /** A new message on an operation you take part in. */
  JOB_MESSAGE: 'JOB_MESSAGE',
  /** The due time of an operation assigned to you moved. */
  JOB_RESCHEDULED: 'JOB_RESCHEDULED',
  /** The worker handed back an operation you are responsible for. */
  JOB_DECLINED: 'JOB_DECLINED',
  /** A result was submitted and waits for your verification. */
  JOB_SUBMITTED: 'JOB_SUBMITTED',
  /** Your submission was sent back for rework. */
  JOB_REJECTED: 'JOB_REJECTED',
  /** The worker could not carry out an operation you are responsible for. */
  JOB_FAILED: 'JOB_FAILED',
  /** A shop in your scope has an unpaid order past its due date. */
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/** One entry of the signed-in user's notification inbox. */
export interface AppNotification {
  readonly id: string;
  readonly type: NotificationType;
  /** The operation it is about (every type except PAYMENT_OVERDUE). */
  readonly jobId: string | null;
  /** The shop it is about (PAYMENT_OVERDUE; operation notifications may carry it too). */
  readonly shopId: string | null;
  readonly title: string;
  readonly body: string;
  /** ISO 8601 timestamps. */
  readonly createdAt: string;
  readonly readAt: string | null;
}

/** One page of GET /api/v1/notifications, newest first. */
export interface NotificationPage {
  readonly items: readonly AppNotification[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

/** PUT /api/v1/notifications/devices/current: this session's FCM registration token. */
export interface RegisterPushDeviceRequest {
  readonly token: string;
}

/**
 * The `data` of a push message. Deliberately minimal: no business content travels through
 * FCM; the app fetches the details with the user's own credentials after the tap. FCM data
 * values are strings, so a missing ID is an empty string.
 */
export interface PushData {
  readonly type: NotificationType;
  readonly jobId: string;
  readonly shopId: string;
  readonly notificationId: string;
}
