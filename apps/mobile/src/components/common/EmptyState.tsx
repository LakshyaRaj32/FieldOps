import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, Button, Icon, type IconName } from '../ui';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  /** What is missing, for example `notifications-outline`. */
  readonly icon?: IconName;
  readonly actionLabel?: string;
  readonly actionIcon?: IconName;
  readonly onAction?: () => void;
}

/** Shown when a screen or section has nothing to display yet: icon, title, why, action. */
export function EmptyState({
  title,
  description,
  icon = 'file-tray-outline',
  actionLabel,
  actionIcon,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.container,
        {
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.xl,
          paddingHorizontal: theme.spacing.lg,
        },
      ]}
    >
      <View
        style={[
          styles.mark,
          {
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.primaryMuted,
            marginBottom: theme.spacing.xs,
          },
        ]}
      >
        <Icon name={icon} size="lg" tone="primary" />
      </View>
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      {description !== undefined ? (
        <AppText tone="muted" style={[styles.centered, styles.description]}>
          {description}
        </AppText>
      ) : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          size="sm"
          {...(actionIcon !== undefined && { icon: actionIcon })}
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  mark: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  description: { maxWidth: 320 },
});
