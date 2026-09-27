import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import type { AppTheme } from '../../theme';

/** Header style shared by every stack (flat, the theme's surface). */
export function stackScreenOptions(
  theme: AppTheme,
): NativeStackNavigationOptions {
  return {
    headerTitleStyle: { fontSize: 18, fontWeight: '700' },
    headerShadowVisible: false,
    headerStyle: { backgroundColor: theme.colors.surface },
  };
}
