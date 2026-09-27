/**
 * Money crosses the API as integers in minor units (paise), stored as BIGINT. JavaScript
 * numbers are exact up to 2^53, far above any balance this product will hold (about
 * ₹90 trillion); converting refuses anything beyond, rather than silently rounding.
 */
export function toAmount(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('Amount is outside the safe integer range');
  }
  return amount;
}

export function toAmountOrNull(value: bigint | null): number | null {
  return value === null ? null : toAmount(value);
}

/**
 * The organization's calendar date of an instant, as YYYY-MM-DD ("today" for due dates and
 * daily figures). en-CA formats dates as YYYY-MM-DD.
 */
export function calendarDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** A DATE column value (midnight UTC) from YYYY-MM-DD. */
export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** YYYY-MM-DD of a DATE column value. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The instant the organization's calendar day `date` (YYYY-MM-DD) starts, in `timeZone`.
 * Found by correcting a UTC guess by the zone's offset at that moment (twice, which also
 * settles days that start inside a DST change).
 */
export function startOfDay(date: string, timeZone: string): Date {
  let guess = dateOnly(date).getTime();
  for (let i = 0; i < 2; i += 1) {
    guess = dateOnly(date).getTime() - offsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
