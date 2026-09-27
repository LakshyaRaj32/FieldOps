import { NotificationType } from '@fieldops/types';

import type { BadgeTone, IconName } from '../../components/ui';

/**
 * How each kind of notification is shown: a filled icon while unread, the outline once read,
 * and the tone of its icon. Pure data, so every row of the inbox looks the same.
 */
export const NOTIFICATION_KINDS: Readonly<
  Record<
    NotificationType,
    {
      readonly unreadIcon: IconName;
      readonly readIcon: IconName;
      readonly tone: Exclude<BadgeTone, 'neutral'>;
    }
  >
> = {
  [NotificationType.JOB_ASSIGNED]: {
    unreadIcon: 'briefcase',
    readIcon: 'briefcase-outline',
    tone: 'primary',
  },
  [NotificationType.JOB_UNASSIGNED]: {
    unreadIcon: 'swap-horizontal',
    readIcon: 'swap-horizontal-outline',
    tone: 'warning',
  },
  [NotificationType.JOB_CANCELLED]: {
    unreadIcon: 'close-circle',
    readIcon: 'close-circle-outline',
    tone: 'danger',
  },
  [NotificationType.JOB_COMPLETED]: {
    unreadIcon: 'checkmark-circle',
    readIcon: 'checkmark-circle-outline',
    tone: 'success',
  },
  [NotificationType.JOB_MESSAGE]: {
    unreadIcon: 'chatbubble-ellipses',
    readIcon: 'chatbubble-ellipses-outline',
    tone: 'info',
  },
  [NotificationType.JOB_RESCHEDULED]: {
    unreadIcon: 'calendar',
    readIcon: 'calendar-outline',
    tone: 'info',
  },
  [NotificationType.JOB_DECLINED]: {
    unreadIcon: 'return-down-back',
    readIcon: 'return-down-back-outline',
    tone: 'warning',
  },
  [NotificationType.JOB_SUBMITTED]: {
    unreadIcon: 'shield-checkmark',
    readIcon: 'shield-checkmark-outline',
    tone: 'warning',
  },
  [NotificationType.JOB_REJECTED]: {
    unreadIcon: 'arrow-undo',
    readIcon: 'arrow-undo-outline',
    tone: 'danger',
  },
  [NotificationType.JOB_FAILED]: {
    unreadIcon: 'alert-circle',
    readIcon: 'alert-circle-outline',
    tone: 'danger',
  },
  [NotificationType.PAYMENT_OVERDUE]: {
    unreadIcon: 'wallet',
    readIcon: 'wallet-outline',
    tone: 'danger',
  },
};

/** "3 unread" / "All caught up", above the list. */
export function describeUnread(unreadCount: number): string {
  return unreadCount === 0 ? 'All caught up' : `${unreadCount} unread`;
}
