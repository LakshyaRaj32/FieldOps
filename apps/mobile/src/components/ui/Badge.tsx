import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme, type AppTheme } from '../../theme';
import { AppText } from './AppText';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
}

function badgeColors(
  theme: AppTheme,
  tone: BadgeTone,
): { background: string; text: string } {
  const { colors } = theme;
  switch (tone) {
    case 'neutral':
      return { background: colors.surfaceMuted, text: colors.textMuted };
    case 'primary':
      return { background: colors.primaryMuted, text: colors.primary };
    case 'success':
      return { background: colors.successMuted, text: colors.success };
    case 'warning':
      return { background: colors.warningMuted, text: colors.warning };
    case 'danger':
      return { background: colors.dangerMuted, text: colors.danger };
  }
}

/** A compact status label (role, environment, connectivity). */
export function Badge({
  label,
  tone = 'neutral',
}: BadgeProps): React.JSX.Element {
  const theme = useTheme();
  const colors = badgeColors(theme, tone);
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.background,
          borderRadius: theme.radii.pill,
          paddingHorizontal: theme.spacing.sm,
        },
      ]}
    >
      <AppText variant="label" style={{ color: colors.text }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
  },
});
