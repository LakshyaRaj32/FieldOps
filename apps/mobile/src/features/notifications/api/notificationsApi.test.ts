import type { NotificationPage } from '@fieldops/types';

import { isNotificationPage, markReadInPage } from './notificationsApi';

describe('isNotificationPage', () => {
  const notification = {
    id: 'n-1',
    type: 'JOB_ASSIGNED',
    jobId: 'job-1',
    title: 'New job assigned',
    shopId: null,
    body: '“AC repair”',
    createdAt: '2026-09-27T09:00:00.000Z',
    readAt: null,
  };

  it('accepts a page of notifications', () => {
    expect(
      isNotificationPage({
        items: [notification],
        nextCursor: null,
        unreadCount: 1,
      }),
    ).toBe(true);
  });

  it('refuses unknown notification types and missing counts', () => {
    expect(
      isNotificationPage({
        items: [{ ...notification, type: 'MARKETING' }],
        nextCursor: null,
        unreadCount: 1,
      }),
    ).toBe(false);
    expect(isNotificationPage({ items: [], nextCursor: null })).toBe(false);
  });
});

describe('markReadInPage', () => {
  const READ_AT = '2026-09-27T10:00:00.000Z';
  const entry = (id: string, readAt: string | null) => ({
    id,
    type: 'JOB_ASSIGNED' as const,
    jobId: `job-${id}`,
    shopId: null,
    title: 'New job assigned',
    body: '“AC repair”',
    createdAt: '2026-09-27T09:00:00.000Z',
    readAt,
  });
  const page: NotificationPage = {
    items: [
      entry('a', null),
      entry('b', '2026-09-26T08:00:00.000Z'),
      entry('c', null),
    ],
    nextCursor: 'next',
    // The server counts unread entries beyond the loaded page too.
    unreadCount: 5,
  };

  it('marks every unread entry read and clears the count, keeping order and content', () => {
    const result = markReadInPage(page, null, READ_AT);

    expect(result.items.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.items.map(item => item.readAt)).toEqual([
      READ_AT,
      '2026-09-26T08:00:00.000Z',
      READ_AT,
    ]);
    expect(result.items.map(item => item.title)).toEqual(
      page.items.map(item => item.title),
    );
    expect(result.unreadCount).toBe(0);
    expect(result.nextCursor).toBe('next');
  });

  it('marks one entry read and lowers the count by one', () => {
    const result = markReadInPage(page, 'c', READ_AT);

    expect(result.items.map(item => item.readAt)).toEqual([
      null,
      '2026-09-26T08:00:00.000Z',
      READ_AT,
    ]);
    expect(result.unreadCount).toBe(4);
  });

  it('leaves the page unchanged when there is nothing to mark', () => {
    expect(markReadInPage(page, 'b', READ_AT)).toBe(page);
    const allRead = markReadInPage(page, null, READ_AT);
    expect(markReadInPage(allRead, null, READ_AT)).toBe(allRead);
  });
});
