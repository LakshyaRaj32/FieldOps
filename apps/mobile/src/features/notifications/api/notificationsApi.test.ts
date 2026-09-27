import { isNotificationPage } from './notificationsApi';

describe('isNotificationPage', () => {
  const notification = {
    id: 'n-1',
    type: 'JOB_ASSIGNED',
    jobId: 'job-1',
    title: 'New job assigned',
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
