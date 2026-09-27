import {
  NotificationType,
  type AppNotification,
  type NotificationPage,
} from '@fieldops/types';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { parseError } from '../../../utils/errors';

/**
 * The signed-in user's notification inbox and this device's push registration. Online only
 * (RTK Query): the inbox is a convenience view; what matters for offline work (jobs,
 * messages) is in SQLite and arrives through sync.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const TYPES: readonly string[] = Object.values(NotificationType);

function isNotification(value: unknown): value is AppNotification {
  if (!isRecord(value)) {
    return false;
  }
  const { id, type, jobId, title, body, createdAt, readAt } = value;
  return (
    [id, jobId, title, body, createdAt].every(
      field => typeof field === 'string',
    ) &&
    TYPES.includes(type as string) &&
    (readAt === null || typeof readAt === 'string')
  );
}

export function isNotificationPage(value: unknown): value is NotificationPage {
  if (!isRecord(value)) {
    return false;
  }
  const { items, nextCursor, unreadCount } = value;
  return (
    Array.isArray(items) &&
    items.every(isNotification) &&
    (nextCursor === null || typeof nextCursor === 'string') &&
    typeof unreadCount === 'number'
  );
}

const INBOX = { type: 'Notification', id: 'INBOX' } as const;

/** Marks one entry (or every entry, with `null`) read in a cached page. Pure. */
export function markReadInPage(
  page: NotificationPage,
  id: string | null,
  readAt: string,
): NotificationPage {
  let marked = 0;
  const items = page.items.map(item => {
    if (item.readAt !== null || (id !== null && item.id !== id)) {
      return item;
    }
    marked += 1;
    return { ...item, readAt };
  });
  return marked === 0
    ? page
    : {
        ...page,
        items,
        unreadCount: id === null ? 0 : Math.max(0, page.unreadCount - marked),
      };
}

export const notificationsApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Notification'] })
  .injectEndpoints({
    endpoints: build => ({
      /** The newest 50: enough for a field worker's inbox; older ones stay on the server. */
      getNotifications: build.query<NotificationPage, void>({
        queryFn: async (_arg, _api, _extra, send) => {
          const result = await send(`${API_V1}/notifications?limit=50`);
          if (result.error !== undefined) {
            return { error: result.error };
          }
          return isNotificationPage(result.data)
            ? { data: result.data }
            : { error: parseError('Unexpected notifications response') };
        },
        providesTags: [INBOX],
      }),

      /*
       * Marking read changes only the read state. The cached inbox is updated at once
       * (entries stay where they are, the unread badge drops), the request follows, and a
       * failure puts the previous state back. The refetch afterwards (the tag) brings in the
       * server's own timestamps.
       */
      markNotificationRead: build.mutation<null, string>({
        query: id => ({
          url: `${API_V1}/notifications/${id}/read`,
          method: 'POST',
        }),
        onQueryStarted: async (id, { dispatch, queryFulfilled }) => {
          const patch = dispatch(
            notificationsApi.util.updateQueryData(
              'getNotifications',
              undefined,
              page => markReadInPage(page, id, new Date().toISOString()),
            ),
          );
          await queryFulfilled.catch(() => patch.undo());
        },
        invalidatesTags: [INBOX],
      }),

      markAllNotificationsRead: build.mutation<null, void>({
        query: () => ({
          url: `${API_V1}/notifications/read-all`,
          method: 'POST',
        }),
        onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
          const patch = dispatch(
            notificationsApi.util.updateQueryData(
              'getNotifications',
              undefined,
              page => markReadInPage(page, null, new Date().toISOString()),
            ),
          );
          await queryFulfilled.catch(() => patch.undo());
        },
        invalidatesTags: [INBOX],
      }),

      registerPushDevice: build.mutation<null, string>({
        query: token => ({
          url: `${API_V1}/notifications/devices/current`,
          method: 'PUT',
          body: { token },
        }),
      }),
    }),
  });

export const {
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationsApi;
