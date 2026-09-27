/**
 * Delivery of one push message to one device. The notifications module decides WHAT to send
 * and to whom; a PushSender only transports it (docs/notifications.md, "Delivery").
 */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** String values only (an FCM requirement). IDs, never content. */
  readonly data: Readonly<Record<string, string>>;
}

export type PushResult =
  /** Accepted by the push service (delivery to the device is still not guaranteed). */
  | 'sent'
  /** The token is unknown or expired: the registration must be removed. */
  | 'invalid_token'
  /** A temporary failure (network, quota, service error). Not retried before Phase 5. */
  | 'failed'
  /** Push is not configured in this environment. */
  | 'disabled';

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushResult>;
}

/** Injection token for PushSender. */
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * Used when FCM_SERVICE_ACCOUNT_FILE is not set (local development without a Firebase
 * project, CI). Nothing is sent; in-app notifications and realtime keep working, and the
 * API says so once at startup.
 */
export class DisabledPushSender implements PushSender {
  send(): Promise<PushResult> {
    return Promise.resolve('disabled');
  }
}
