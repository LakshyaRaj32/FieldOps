import React from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme';
import { toAppError } from '../../utils/errors';
import { AppText, Button } from '../ui';

export interface ErrorStateProps {
  /** Any error value; it is normalized into a user-facing message. */
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
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.dangerMuted,
      }}
    >
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
        <Button label="Try again" onPress={onRetry} variant="secondary" />
      ) : null}
    </View>
  );
}
