import { darkTheme, lightTheme, type AppTheme } from './themes';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Validates a persisted value; anything unknown (or missing) falls back to `system`. */
export function parseThemePreference(
  value: string | undefined,
): ThemePreference {
  return (THEME_PREFERENCES as readonly (string | undefined)[]).includes(value)
    ? (value as ThemePreference)
    : 'system';
}

/**
 * Resolves the theme to render. `systemScheme` comes from useColorScheme(), which may
 * report values other than light/dark (for example when the OS has no preference).
 */
export function resolveTheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): AppTheme {
  if (preference === 'light') {
    return lightTheme;
  }
  if (preference === 'dark') {
    return darkTheme;
  }
  return systemScheme === 'dark' ? darkTheme : lightTheme;
}
