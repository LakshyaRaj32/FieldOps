import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';
import { AppText } from '../ui';

export interface LoadingStateProps {
  readonly message?: string;
}

export function LoadingState({
  message,
}: LoadingStateProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Loading'}
      style={[
        styles.container,
        { gap: theme.spacing.sm, padding: theme.spacing.xl },
      ]}
    >
      <ActivityIndicator color={theme.colors.primary} />
      {message !== undefined ? <AppText tone="muted">{message}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
