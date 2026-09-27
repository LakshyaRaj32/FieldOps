import { NotificationType } from '@fieldops/types';

/**
 * Where a notification leads (a push tap or an inbox entry). Pure, and unit-tested.
 *
 * Push data crosses a trust boundary (it arrives through Google's servers), so it is
 * validated: only a known type and UUID IDs produce a route. The operation or shop itself is
 * then loaded with the user's own credentials, so a forged push could at most open a screen
 * that shows "not found".
 */
export type NotificationRoute =
  | { readonly screen: 'job'; readonly jobId: string }
  | { readonly screen: 'shop'; readonly shopId: string }
  | { readonly screen: 'inbox' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: readonly string[] = Object.values(NotificationType);

const isId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export function routeFor(notification: {
  readonly type?: unknown;
  readonly jobId?: unknown;
  readonly shopId?: unknown;
}): NotificationRoute | null {
  const { type, jobId, shopId } = notification;
  if (typeof type !== 'string' || !TYPES.includes(type)) {
    return null;
  }
  // An operation taken away from the user cannot be opened any more: show the inbox.
  if (type === NotificationType.JOB_UNASSIGNED) {
    return { screen: 'inbox' };
  }
  // An overdue payment is about a shop and its account.
  if (type === NotificationType.PAYMENT_OVERDUE) {
    return isId(shopId)
      ? { screen: 'shop', shopId: shopId.toLowerCase() }
      : null;
  }
  if (!isId(jobId)) {
    return null;
  }
  return { screen: 'job', jobId: jobId.toLowerCase() };
}
