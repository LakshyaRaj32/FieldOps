import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  PreferenceKeys,
  preferencesStorage,
} from '../services/storage/preferencesStorage';
import {
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from './themePreference';
import type { AppTheme } from './themes';

interface ThemeContextValue {
  readonly theme: AppTheme;
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provides the active theme. The user's preference (system/light/dark) is persisted in
 * MMKV and read synchronously on startup, so the first frame already uses the right theme.
 */
export function ThemeProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    parseThemePreference(
      preferencesStorage.getString(PreferenceKeys.themePreference),
    ),
  );

  const setPreference = useCallback((next: ThemePreference) => {
    preferencesStorage.setString(PreferenceKeys.themePreference, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: resolveTheme(preference, systemScheme),
      preference,
      setPreference,
    }),
    [preference, systemScheme, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('Theme hooks must be used inside <ThemeProvider>.');
  }
  return context;
}

export function useTheme(): AppTheme {
  return useThemeContext().theme;
}

export function useThemePreference(): Pick<
  ThemeContextValue,
  'preference' | 'setPreference'
> {
  const { preference, setPreference } = useThemeContext();
  return { preference, setPreference };
}
