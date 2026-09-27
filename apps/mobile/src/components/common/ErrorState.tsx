import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { toAppError } from '../../utils/errors';
import { AppText, Button, Icon } from '../ui';

export interface ErrorStateProps {
  /** Any error value; it is normalized into a user-facing message (never the raw error). */
  readonly error: unknown;
  readonly title?: string;
  readonly onRetry?: () => void;
}

/** Displays a failure with a user-safe message and an optional retry. */
export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
}: ErrorStateProps): React.JSX.Element {
  const theme = useTheme();
  const appError = toAppError(error);

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.dangerMuted,
        },
      ]}
    >
      <Icon name="alert-circle" tone="danger" />
      <View style={[styles.body, { gap: theme.spacing.xs }]}>
        <AppText variant="bodyStrong" tone="danger">
          {title}
        </AppText>
        <AppText>{appError.message}</AppText>
        {appError.requestId !== undefined ? (
          <AppText variant="caption" tone="muted" selectable>
            Reference: {appError.requestId}
          </AppText>
        ) : null}
        {onRetry !== undefined ? (
          <Button
            label="Try again"
            icon="refresh"
            onPress={onRetry}
            variant="secondary"
            size="sm"
            style={[styles.retry, { marginTop: theme.spacing.xs }]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start' },
  body: { flex: 1 },
  retry: { alignSelf: 'flex-start' },
});
