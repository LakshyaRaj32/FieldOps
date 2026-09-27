import React from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import type { AppNotification } from '@fieldops/types';

import type { AppTabScreenProps } from '../../../app/navigation/types';
import { EmptyState } from '../../../components/common/EmptyState';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { AppText, Badge, Button, Card, Screen } from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  useGetNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
} from '../api/notificationsApi';
import { routeFor } from '../notificationRouting';

const when = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : `${date.toLocaleDateString()} ${date
        .toLocaleTimeString()
        .replace(/:\d{2}(?=\s|$)/, '')}`;
};

/**
 * The user's notification inbox (online). Tapping an entry marks it read and opens its job.
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
      <Screen contentStyle={styles.centered}>
        {isLoading ? (
          <LoadingState message="Loading notifications…" />
        ) : (
          <ErrorState
            title="Couldn't load notifications"
            error={error}
            onRetry={refresh}
          />
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

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refresh}
          colors={[theme.colors.primary]}
        />
      }
    >
      {data.items.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="New assignments, cancellations, completions and job messages appear here."
        />
      ) : null}
      {data.unreadCount > 0 ? (
        <Button
          label="Mark all as read"
          variant="secondary"
          loading={markAllState.isLoading}
          onPress={() => {
            markAllRead().catch(() => undefined);
          }}
        />
      ) : null}
      {data.items.map(notification => (
        <Pressable
          key={notification.id}
          accessibilityRole="button"
          accessibilityLabel={`${notification.title}. ${notification.body}`}
          onPress={() => open(notification)}
        >
          <Card>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <AppText variant="heading" style={styles.title}>
                {notification.title}
              </AppText>
              {notification.readAt === null ? (
                <Badge label="New" tone="primary" />
              ) : null}
            </View>
            <AppText>{notification.body}</AppText>
            <AppText variant="caption" tone="muted">
              {when(notification.createdAt)}
            </AppText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { flexShrink: 1 },
});
