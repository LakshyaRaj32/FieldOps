import {
  formatDateLabel,
  formatRelativeTime,
  formatTimeLabel,
} from './dateFormat';

describe('date formatting', () => {
  it('shows picked dates and times readably', () => {
    const date = new Date(2026, 8, 28, 14, 5);
    expect(formatDateLabel(date)).toBe('Mon, 28 Sep 2026');
    expect(formatTimeLabel(date)).toBe('2:05 PM');
    expect(formatTimeLabel(new Date(2026, 8, 28, 0, 30))).toBe('12:30 AM');
  });

  it('describes how long ago something happened', () => {
    const now = new Date(2026, 8, 27, 12, 0);
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(formatRelativeTime(ago(20_000), now)).toBe('Just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(
      formatRelativeTime(new Date(2026, 8, 26, 9, 0).toISOString(), now),
    ).toBe('Yesterday');
    expect(
      formatRelativeTime(new Date(2026, 8, 23, 9, 0).toISOString(), now),
    ).toBe('4 days ago');
    expect(
      formatRelativeTime(new Date(2026, 8, 2, 9, 0).toISOString(), now),
    ).toBe('2 Sep');
    expect(
      formatRelativeTime(new Date(2025, 11, 30, 9, 0).toISOString(), now),
    ).toBe('30 Dec 2025');
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});
