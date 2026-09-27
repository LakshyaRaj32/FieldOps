import React from 'react';
import { Text, type TextProps } from 'react-native';

import { useTheme, type AppTheme, type TypographyVariant } from '../../theme';

export type TextTone =
  | 'default'
  | 'muted'
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'info';

export interface AppTextProps extends TextProps {
  readonly variant?: TypographyVariant;
  readonly tone?: TextTone;
}

function toneColor(theme: AppTheme, tone: TextTone): string {
  switch (tone) {
    case 'default':
      return theme.colors.text;
    case 'muted':
      return theme.colors.textMuted;
    case 'primary':
      return theme.colors.primary;
    case 'danger':
      return theme.colors.danger;
    case 'warning':
      return theme.colors.warning;
    case 'success':
      return theme.colors.success;
    case 'info':
      return theme.colors.info;
  }
}

/** Themed text. Use it instead of <Text> so typography and colors stay consistent. */
export function AppText({
  variant = 'body',
  tone = 'default',
  style,
  ...rest
}: AppTextProps): React.JSX.Element {
  const theme = useTheme();
  const color = toneColor(theme, tone);
  return (
    <Text {...rest} style={[theme.typography[variant], { color }, style]} />
  );
}
