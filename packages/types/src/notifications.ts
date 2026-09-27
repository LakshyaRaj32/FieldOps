/**
 * In-app notifications and push registration. See docs/notifications.md.
 */

export const NotificationType = {
  /** A job was assigned to you. */
  JOB_ASSIGNED: 'JOB_ASSIGNED',
  /** A job you had was reassigned to someone else. */
  JOB_UNASSIGNED: 'JOB_UNASSIGNED',
  /** A job assigned to you was cancelled. */
  JOB_CANCELLED: 'JOB_CANCELLED',
  /** A job you created was completed. */
  JOB_COMPLETED: 'JOB_COMPLETED',
  /** A new message on a job you take part in. */
  JOB_MESSAGE: 'JOB_MESSAGE',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

/** One entry of the signed-in user's notification inbox. */
export interface AppNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly jobId: string;
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
 * The `data` of a push message. Deliberately minimal: no job content travels through FCM;
 * the app fetches the job with the user's own credentials after the tap.
 */
export interface PushData {
  readonly type: NotificationType;
  readonly jobId: string;
  readonly notificationId: string;
}
