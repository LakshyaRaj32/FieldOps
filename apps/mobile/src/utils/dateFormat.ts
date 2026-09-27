/**
 * Readable dates and times for form fields, in the device's time zone. Pure (no Intl), so
 * the output is the same on every device and in tests.
 */

const pad = (value: number) => String(value).padStart(2, '0');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

/** "Mon, 28 Sep 2026". */
export function formatDateLabel(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${
    MONTHS[date.getMonth()]
  } ${date.getFullYear()}`;
}

/** "10:30 AM". */
export function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${pad(
    date.getMinutes(),
  )} ${suffix}`;
}

/**
 * How long ago something happened, for lists: "Just now", "5 min ago", "3 h ago",
 * "Yesterday", "4 days ago", then the date ("28 Sep", with the year when it differs).
 */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000));
  if (seconds < 60) {
    return 'Just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  const year =
    date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}
