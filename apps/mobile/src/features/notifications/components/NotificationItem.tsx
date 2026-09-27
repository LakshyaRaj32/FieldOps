import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AppNotification } from '@fieldops/types';

import { AppText, badgeColors, Icon, Skeleton } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { formatRelativeTime } from '../../../utils/dateFormat';
import { NOTIFICATION_KINDS } from '../presentation';

/**
 * One inbox entry as a compact row: icon, title, a two-line preview and the time.
 *
 * Unread and read differ in several ways at once, so the difference does not rest on color:
 * unread rows sit on the brighter surface with a bold title, a filled, colored icon and a
 * dot; read rows sit on the page background with regular weight, an outline icon and muted
 * text (still at readable contrast). Screen readers hear "Unread" first.
 */
export function NotificationItem({
  notification,
  onPress,
}: {
  readonly notification: AppNotification;
  readonly onPress: (notification: AppNotification) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const unread = notification.readAt === null;
  const kind = NOTIFICATION_KINDS[notification.type];
  const tone = badgeColors(theme, kind.tone);
  const time = formatRelativeTime(notification.createdAt);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${notification.title}. ${
        notification.body
      }. ${time}`}
      accessibilityHint="Opens the job"
      onPress={() => onPress(notification)}
      style={({ pressed }) => [
        styles.row,
        {
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          backgroundColor: pressed
            ? theme.colors.surfaceMuted
            : unread
            ? theme.colors.surface
            : theme.colors.background,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          {
            borderRadius: theme.radii.pill,
            backgroundColor: unread
              ? tone.background
              : theme.colors.surfaceMuted,
          },
        ]}
      >
        <Icon
          name={unread ? kind.unreadIcon : kind.readIcon}
          size="md"
          color={unread ? tone.text : theme.colors.textMuted}
        />
      </View>
      <View style={[styles.text, { gap: theme.spacing.xxs }]}>
        <View style={[styles.titleRow, { gap: theme.spacing.sm }]}>
          <AppText
            variant={unread ? 'bodyStrong' : 'body'}
            tone={unread ? 'default' : 'muted'}
            numberOfLines={1}
            style={styles.title}
          >
            {notification.title}
          </AppText>
          <AppText
            variant={unread ? 'captionStrong' : 'caption'}
            tone={unread ? 'primary' : 'muted'}
          >
            {time}
          </AppText>
        </View>
        <AppText
          variant="caption"
          tone={unread ? 'default' : 'muted'}
          numberOfLines={2}
        >
          {notification.body}
        </AppText>
      </View>
      <View
        style={[
          styles.dot,
          unread && { backgroundColor: theme.colors.primary },
        ]}
      />
    </Pressable>
  );
}

/** A row-shaped placeholder while the inbox loads. */
export function NotificationItemSkeleton(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <Skeleton width={36} height={36} radius="pill" />
      <View style={[styles.text, { gap: theme.spacing.sm }]}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="90%" height={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
