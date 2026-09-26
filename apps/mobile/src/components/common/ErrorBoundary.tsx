import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { logger } from '../../utils/logger';
import { AppText, Button } from '../ui';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Catches errors thrown while rendering, logs them, and shows a recovery screen instead of
 * a blank app. Errors in event handlers and async code are not caught by React boundaries;
 * those surface through ErrorState or the global error handler.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Render error caught by ErrorBoundary', {
      error: `${error.name}: ${error.message}`,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({
  onReset,
}: {
  readonly onReset: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.fallback,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.xl,
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      <AppText variant="title">Something went wrong</AppText>
      <AppText tone="muted">
        The app hit an unexpected problem. Your work on this device is not
        affected. Try again, and if it keeps happening, restart the app.
      </AppText>
      <Button label="Try again" onPress={onReset} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { flex: 1, justifyContent: 'center' },
});
