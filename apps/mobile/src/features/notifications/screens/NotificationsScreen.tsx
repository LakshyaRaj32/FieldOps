import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import type { AppNotification } from '@fieldops/types';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { AppText, Button, Screen } from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '../api/notificationsApi';
import {
  NotificationItem,
  NotificationItemSkeleton,
} from '../components/NotificationItem';
import { routeFor } from '../notificationRouting';
import { describeUnread } from '../presentation';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * The user's notification inbox (online). Tapping an entry marks it read and opens its job;
 * "Mark all as read" changes only the read state (entries stay, nothing navigates). Both
 * update the list and the tab badge at once and are undone if the server refuses.
 * Push notifications, when available, are copies of these entries.
 */
export function NotificationsScreen({
  navigation,
}: AppTabScreenProps<'Notifications'>): React.JSX.Element {
  const theme = useTheme();
  const { data, error, isLoading, isFetching, refetch } =
    useGetNotificationsQuery();
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead, markAllState] = useMarkAllNotificationsReadMutation();

  const refresh = () => {
    refetch().catch(() => undefined);
  };

  if (data === undefined) {
    return (
      <Screen scroll={false} contentStyle={styles.flush}>
        {isLoading ? (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Loading notifications"
          >
            {SKELETON_ROWS.map(row => (
              <NotificationItemSkeleton key={row} />
            ))}
          </View>
        ) : (
          <View style={{ padding: theme.spacing.lg }}>
            <ErrorState
              title="Couldn't load notifications"
              error={error}
              onRetry={refresh}
            />
          </View>
        )}
      </Screen>
    );
  }

  const open = (notification: AppNotification) => {
    if (notification.readAt === null) {
      markRead(notification.id).catch(() => undefined);
    }
    const route = routeFor(notification);
    if (route?.screen === 'job') {
      navigation.navigate('Jobs', {
        screen: 'JobDetail',
        params: { jobId: route.jobId },
        initial: false,
      });
    }
  };

  const header =
    data.items.length === 0 ? undefined : (
      <View
        style={[
          styles.header,
          {
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <View style={[styles.headerRow, { gap: theme.spacing.sm }]}>
          <AppText
            variant="captionStrong"
            tone="muted"
            style={styles.fill}
            accessibilityLiveRegion="polite"
          >
            {describeUnread(data.unreadCount)}
          </AppText>
          {data.unreadCount > 0 ? (
            <Button
              label="Mark all as read"
              icon="checkmark-done"
              variant="ghost"
              size="sm"
              loading={markAllState.isLoading}
              onPress={() => {
                markAllRead().catch(() => undefined);
              }}
            />
          ) : null}
        </View>
        {markAllState.isError ? (
          <AppText variant="caption" tone="danger" accessibilityRole="alert">
            Couldn't mark your notifications as read. Check your connection and
            try again.
          </AppText>
        ) : null}
      </View>
    );

  return (
    <Screen scroll={false} contentStyle={styles.flush}>
      <FlatList
        data={data.items}
        keyExtractor={notification => notification.id}
        renderItem={({ item }) => (
          <NotificationItem notification={item} onPress={open} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-outline"
            title="You're all caught up"
            description="New assignments, cancellations, completions and job messages appear here."
          />
        }
        contentContainerStyle={
          data.items.length === 0 ? styles.emptyContent : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refresh}
            colors={[theme.colors.primary]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0, gap: 0 },
  fill: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
});
