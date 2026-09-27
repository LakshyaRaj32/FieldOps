import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

export interface CardProps {
  /**
   * `md` (12) for dense content such as list rows and metric tiles; `lg` (16, the default)
   * for sections of a screen.
   */
  readonly padding?: 'md' | 'lg';
  readonly style?: StyleProp<ViewStyle>;
}

/** A raised surface for grouping related content: a hairline border plus a soft shadow. */
export function Card({
  children,
  padding = 'lg',
  style,
}: PropsWithChildren<CardProps>): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        theme.elevation.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
          padding: theme.spacing[padding],
          gap: theme.spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
});
