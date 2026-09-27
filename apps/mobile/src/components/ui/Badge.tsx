import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme, type AppTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  /** A small leading icon, so the meaning does not rest on color alone. */
  readonly icon?: IconName;
}

export function badgeColors(
  theme: AppTheme,
  tone: BadgeTone,
): { background: string; text: string } {
  const { colors } = theme;
  switch (tone) {
    case 'neutral':
      return { background: colors.surfaceMuted, text: colors.textMuted };
    case 'primary':
      return { background: colors.primaryMuted, text: colors.primary };
    case 'info':
      return { background: colors.infoMuted, text: colors.info };
    case 'success':
      return { background: colors.successMuted, text: colors.success };
    case 'warning':
      return { background: colors.warningMuted, text: colors.warning };
    case 'danger':
      return { background: colors.dangerMuted, text: colors.danger };
  }
}

/** A compact status label (job status, role, sync state). */
export function Badge({
  label,
  tone = 'neutral',
  icon,
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
          gap: theme.spacing.xs,
        },
      ]}
    >
      {icon !== undefined ? (
        <Icon name={icon} size="sm" color={colors.text} />
      ) : null}
      <AppText variant="captionStrong" style={{ color: colors.text }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
});
