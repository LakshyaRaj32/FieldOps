import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

import type { AppTheme } from '../../theme';

/** Maps the FieldOps theme onto React Navigation's theme (headers, tab bar, backgrounds). */
export function toNavigationTheme(theme: AppTheme): Theme {
  const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.danger,
    },
  };
}
