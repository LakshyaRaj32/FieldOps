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

      markNotificationRead: build.mutation<null, string>({
        query: id => ({
          url: `${API_V1}/notifications/${id}/read`,
          method: 'POST',
        }),
        invalidatesTags: [INBOX],
      }),

      markAllNotificationsRead: build.mutation<null, void>({
        query: () => ({
          url: `${API_V1}/notifications/read-all`,
          method: 'POST',
        }),
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
