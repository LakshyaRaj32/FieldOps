import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme, type AppTheme } from '../../theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  /** `md` (48 dp, the default) for actions; `sm` (40 dp) for secondary actions in a row. */
  readonly size?: ButtonSize;
  /** A leading icon; replaced by the spinner while loading. */
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityHint?: string;
}

interface VariantColors {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
  readonly pressed: string;
}

const TRANSPARENT = 'transparent';

function variantColors(theme: AppTheme, variant: ButtonVariant): VariantColors {
  const { colors } = theme;
  switch (variant) {
    case 'primary':
      return {
        background: colors.primary,
        foreground: colors.onPrimary,
        border: colors.primary,
        pressed: colors.primary,
      };
    case 'secondary':
      return {
        background: colors.surface,
        foreground: colors.text,
        border: colors.borderStrong,
        pressed: colors.surfaceMuted,
      };
    case 'ghost':
      return {
        background: TRANSPARENT,
        foreground: colors.primary,
        border: TRANSPARENT,
        pressed: colors.primaryMuted,
      };
    case 'danger':
      return {
        background: colors.dangerMuted,
        foreground: colors.danger,
        border: colors.dangerMuted,
        pressed: colors.dangerMuted,
      };
  }
}

/**
 * The app's button. Every variant has the same height, radius and type, so a screen's
 * actions line up; disabled and loading look the same everywhere (dimmed, not clickable).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const colors = variantColors(theme, variant);
  const inactive = disabled || loading;
  const small = size === 'sm';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint !== undefined && { accessibilityHint })}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={small ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.controlHeights[size],
          backgroundColor:
            pressed && !inactive ? colors.pressed : colors.background,
          borderColor: colors.border,
          borderRadius: theme.radii.md,
          paddingHorizontal: small ? theme.spacing.md : theme.spacing.lg,
        },
        inactive ? styles.inactive : pressed ? styles.pressed : null,
        style,
      ]}
    >
      <View style={[styles.content, { gap: theme.spacing.sm }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : icon !== undefined ? (
          <Icon
            name={icon}
            size={small ? 'sm' : 'md'}
            color={colors.foreground}
          />
        ) : null}
        <AppText
          variant={small ? 'captionStrong' : 'bodyStrong'}
          style={[styles.label, { color: colors.foreground }]}
        >
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.88 },
  inactive: { opacity: 0.5 },
});
