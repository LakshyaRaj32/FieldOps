import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText, Button } from '../ui';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** Shown when a screen or section has nothing to display yet. */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.container,
        { gap: theme.spacing.sm, paddingVertical: theme.spacing.xl },
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
      />
      <AppText variant="heading" style={styles.centered}>
        {title}
      </AppText>
      {description !== undefined ? (
        <AppText tone="muted" style={styles.centered}>
          {description}
        </AppText>
      ) : null}
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  mark: { width: 48, height: 48 },
  centered: { textAlign: 'center' },
});
