import type { OrderStatus, PaymentState } from '@fieldops/types';

import type { BadgeTone } from '../../components/ui';

/** How orders are shown. Money itself is formatted with `money` (jobs/presentation). */

export const ORDER_STATUS_BADGES: Readonly<
  Record<OrderStatus, { label: string; tone: BadgeTone }>
> = {
  OPEN: { label: 'Open', tone: 'primary' },
  PARTIALLY_DELIVERED: { label: 'Partly delivered', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const PAYMENT_STATE_BADGES: Readonly<
  Record<PaymentState, { label: string; tone: BadgeTone }>
> = {
  UNPAID: { label: 'Unpaid', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
};

/** "30 Sep 2026" from a YYYY-MM-DD calendar date (no time zone shift). */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12
  ) {
    return date;
  }
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
