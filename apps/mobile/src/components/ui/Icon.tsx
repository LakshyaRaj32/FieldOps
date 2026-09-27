import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
// The static entry: the font is packaged natively (Android assets), not loaded at runtime.
import {
  Ionicons,
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons/static';

import { useTheme, type AppTheme } from '../../theme';
import type { TextTone } from './AppText';

export type IconName = IoniconsIconName;
export type IconSize = keyof AppTheme['iconSizes'];
export type IconTone = TextTone | 'subtle' | 'onPrimary' | 'info';

export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;
  readonly tone?: IconTone;
  /** Overrides `tone`, for icons on colored surfaces. */
  readonly color?: string;
  /**
   * Icons are decorative by default (hidden from screen readers), because they sit next to
   * text that says the same. Pass a label only for an icon that stands alone.
   */
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<TextStyle>;
}

export function iconColor(theme: AppTheme, tone: IconTone): string {
  const { colors } = theme;
  switch (tone) {
    case 'default':
      return colors.text;
    case 'muted':
      return colors.textMuted;
    case 'subtle':
      return colors.textSubtle;
    case 'primary':
      return colors.primary;
    case 'onPrimary':
      return colors.onPrimary;
    case 'danger':
      return colors.danger;
    case 'warning':
      return colors.warning;
    case 'success':
      return colors.success;
    case 'info':
      return colors.info;
  }
}

/**
 * The app's icon set (Ionicons: outline for inactive states, filled for active ones). Use it
 * instead of importing the icon library, so the whole app keeps one consistent style.
 */
export function Icon({
  name,
  size = 'md',
  tone = 'default',
  color,
  accessibilityLabel,
  style,
}: IconProps): React.JSX.Element {
  const theme = useTheme();
  const decorative = accessibilityLabel === undefined;
  return (
    <Ionicons
      name={name}
      size={theme.iconSizes[size]}
      color={color ?? iconColor(theme, tone)}
      style={style}
      {...(decorative
        ? {
            accessible: false,
            importantForAccessibility: 'no-hide-descendants' as const,
            accessibilityElementsHidden: true,
          }
        : {
            accessible: true,
            accessibilityRole: 'image' as const,
            accessibilityLabel,
          })}
    />
  );
}
