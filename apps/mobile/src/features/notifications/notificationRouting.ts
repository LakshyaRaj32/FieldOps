import { NotificationType } from '@fieldops/types';

/**
 * Where a notification leads (a push tap or an inbox entry). Pure, and unit-tested.
 *
 * Push data crosses a trust boundary (it arrives through Google's servers), so it is
 * validated: only a known type and a UUID job ID produce a route. The job itself is then
 * loaded with the user's own credentials, so a forged push could at most open a screen
 * that shows "not found".
 */
export type NotificationRoute =
  | { readonly screen: 'job'; readonly jobId: string }
  | { readonly screen: 'inbox' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: readonly string[] = Object.values(NotificationType);

export function routeFor(notification: {
  readonly type?: unknown;
  readonly jobId?: unknown;
}): NotificationRoute | null {
  const { type, jobId } = notification;
  if (typeof type !== 'string' || !TYPES.includes(type)) {
    return null;
  }
  // A job taken away from the user cannot be opened any more: show the inbox instead.
  if (type === NotificationType.JOB_UNASSIGNED) {
    return { screen: 'inbox' };
  }
  if (typeof jobId !== 'string' || !UUID.test(jobId)) {
    return null;
  }
  return { screen: 'job', jobId: jobId.toLowerCase() };
}
