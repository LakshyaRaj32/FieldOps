import {
  calendarDate,
  formatDateOnly,
  dateOnly,
  startOfDay,
  toAmount,
} from './money.js';

describe('money and calendar helpers', () => {
  it('converts BIGINT amounts exactly and refuses unsafe ones', () => {
    expect(toAmount(20_000_000n)).toBe(20_000_000);
    expect(() => toAmount(2n ** 60n)).toThrow(RangeError);
  });

  it("gives the organization's calendar date", () => {
    // 20:00 UTC on 30 Sep is already 1 Oct in India.
    const instant = new Date('2026-09-30T20:00:00Z');
    expect(calendarDate(instant, 'Asia/Kolkata')).toBe('2026-10-01');
    expect(calendarDate(instant, 'UTC')).toBe('2026-09-30');
  });

  it('finds the start of a calendar day in a time zone', () => {
    expect(startOfDay('2026-10-01', 'Asia/Kolkata').toISOString()).toBe(
      '2026-09-30T18:30:00.000Z',
    );
    expect(startOfDay('2026-10-01', 'UTC').toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    // Across a DST change (New York, 8 Mar 2026 starts at EST, UTC-5).
    expect(startOfDay('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
  });

  it('round-trips DATE values', () => {
    expect(formatDateOnly(dateOnly('2026-09-30'))).toBe('2026-09-30');
  });
});
