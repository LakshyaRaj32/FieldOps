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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityHint?: string;
}

interface VariantColors {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
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
      };
    case 'secondary':
      return {
        background: colors.surface,
        foreground: colors.text,
        border: colors.border,
      };
    case 'ghost':
      return {
        background: TRANSPARENT,
        foreground: colors.primary,
        border: TRANSPARENT,
      };
    case 'danger':
      return {
        background: colors.dangerMuted,
        foreground: colors.danger,
        border: colors.dangerMuted,
      };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const colors = variantColors(theme, variant);
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint !== undefined && { accessibilityHint })}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.lg,
        },
        inactive ? styles.inactive : pressed ? styles.pressed : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : null}
        <AppText variant="bodyStrong" style={{ color: colors.foreground }}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderWidth: 1,
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.55 },
});
