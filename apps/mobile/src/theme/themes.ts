import { radii, spacing, typography } from './tokens';

/** Semantic colors: components ask for a role ("surface", "danger"), never a hex value. */
export interface ThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly primaryMuted: string;
  readonly danger: string;
  readonly dangerMuted: string;
  readonly warning: string;
  readonly warningMuted: string;
  readonly success: string;
  readonly successMuted: string;
}

export type ThemeMode = 'light' | 'dark';

export interface AppTheme {
  readonly mode: ThemeMode;
  readonly colors: ThemeColors;
  readonly spacing: typeof spacing;
  readonly radii: typeof radii;
  readonly typography: typeof typography;
}

const lightColors: ThemeColors = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF1F5',
  border: '#DFE3EA',
  text: '#111827',
  textMuted: '#5B6472',
  primary: '#2451D6',
  onPrimary: '#FFFFFF',
  primaryMuted: '#E6ECFB',
  danger: '#C2362B',
  dangerMuted: '#FBEAE8',
  warning: '#9A5800',
  warningMuted: '#FFF3DC',
  success: '#1F7A4D',
  successMuted: '#E4F4EB',
};

const darkColors: ThemeColors = {
  background: '#0E1116',
  surface: '#161A21',
  surfaceMuted: '#1D222B',
  border: '#2A303B',
  text: '#F2F4F7',
  textMuted: '#9AA3B2',
  primary: '#7C9CFF',
  onPrimary: '#0B1020',
  primaryMuted: '#1C2540',
  danger: '#FF7B6E',
  dangerMuted: '#3A1E1C',
  warning: '#F5B452',
  warningMuted: '#3A2C14',
  success: '#5BD190',
  successMuted: '#16301F',
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: lightColors,
  spacing,
  radii,
  typography,
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: darkColors,
  spacing,
  radii,
  typography,
};
