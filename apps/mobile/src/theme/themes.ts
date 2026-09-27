import type { ViewStyle } from 'react-native';

import {
  controlHeights,
  iconSizes,
  radii,
  spacing,
  typography,
} from './tokens';

/** Semantic colors: components ask for a role ("surface", "danger"), never a hex value. */
export interface ThemeColors {
  /** Behind everything: screens and lists. */
  readonly background: string;
  /** Cards, inputs, headers, the tab bar. */
  readonly surface: string;
  /** Tracks, placeholders and quiet fills inside a surface. */
  readonly surfaceMuted: string;
  readonly border: string;
  /** Input borders and dividers that must stay visible. */
  readonly borderStrong: string;
  readonly text: string;
  /** Secondary text (meets 4.5:1 on `surface` and `background`). */
  readonly textMuted: string;
  /** Decoration only (disabled icons, chevrons): never for text that must be read. */
  readonly textSubtle: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly primaryMuted: string;
  /** The accent for secondary highlights (metrics, the brand mark). */
  readonly secondary: string;
  readonly secondaryMuted: string;
  readonly danger: string;
  readonly dangerMuted: string;
  readonly warning: string;
  readonly warningMuted: string;
  readonly success: string;
  readonly successMuted: string;
  readonly info: string;
  readonly infoMuted: string;
  /** Behind modals and the full-screen image viewer. */
  readonly overlay: string;
}

export type ThemeMode = 'light' | 'dark';

/**
 * Fills for charts that show job statuses (the dashboard's status breakdown). Separate from
 * the badge colors: adjacent segments must stay distinguishable, including with color
 * vision deficiencies (validated with the dataviz palette checks, light and dark). Cancelled
 * is deliberately neutral. Charts always label every segment, so color is never the only cue.
 */
export interface ChartColors {
  readonly pending: string;
  readonly assigned: string;
  readonly inProgress: string;
  /** Submitted results waiting for verification. */
  readonly submitted: string;
  readonly completed: string;
  readonly cancelled: string;
}

/** Shadows for raised surfaces. Dark mode relies on borders instead of shadows. */
export interface ThemeElevation {
  readonly none: ViewStyle;
  /** Cards and list rows. */
  readonly card: ViewStyle;
  /** Floating elements: overlays on images, sheets. */
  readonly raised: ViewStyle;
}

export interface AppTheme {
  readonly mode: ThemeMode;
  readonly colors: ThemeColors;
  readonly chart: ChartColors;
  readonly elevation: ThemeElevation;
  readonly spacing: typeof spacing;
  readonly radii: typeof radii;
  readonly typography: typeof typography;
  readonly iconSizes: typeof iconSizes;
  readonly controlHeights: typeof controlHeights;
}

const lightColors: ThemeColors = {
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceMuted: '#EDF1F7',
  border: '#E2E7EF',
  borderStrong: '#C5CEDB',
  text: '#0F172A',
  textMuted: '#556274',
  textSubtle: '#8A96A8',
  primary: '#2F5BEA',
  onPrimary: '#FFFFFF',
  primaryMuted: '#E7EDFF',
  secondary: '#0B7A6F',
  secondaryMuted: '#DCF3EF',
  danger: '#C4362B',
  dangerMuted: '#FCEBE9',
  warning: '#9A5800',
  warningMuted: '#FFF2D9',
  success: '#1D7A4C',
  successMuted: '#E2F4EA',
  info: '#0A6FB0',
  infoMuted: '#E1F0FA',
  overlay: 'rgba(15, 23, 42, 0.55)',
};

const darkColors: ThemeColors = {
  background: '#0B0F17',
  surface: '#141A24',
  surfaceMuted: '#1B2230',
  border: '#263041',
  borderStrong: '#3A4659',
  text: '#F1F4F9',
  textMuted: '#9BA6B8',
  textSubtle: '#6B778A',
  primary: '#86A2FF',
  onPrimary: '#0A1024',
  primaryMuted: '#1A2547',
  secondary: '#4FD1BE',
  secondaryMuted: '#0F2E2A',
  danger: '#FF7B6E',
  dangerMuted: '#3A1C1A',
  warning: '#F5B452',
  warningMuted: '#3A2C14',
  success: '#5BD190',
  successMuted: '#133020',
  info: '#6CB8F0',
  infoMuted: '#11283A',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

const lightChart: ChartColors = {
  pending: '#B06A00',
  assigned: '#0A8F80',
  inProgress: '#2F5BEA',
  submitted: '#7A4DD8',
  completed: '#1D7A4C',
  cancelled: '#A3ADBD',
};

const darkChart: ChartColors = {
  pending: '#C4862A',
  assigned: '#26A091',
  inProgress: '#6384EE',
  submitted: '#A083EC',
  completed: '#3F9A60',
  cancelled: '#566275',
};

const NO_SHADOW: ViewStyle = {
  shadowOpacity: 0,
  elevation: 0,
};

const lightElevation: ThemeElevation = {
  none: NO_SHADOW,
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
};

const darkElevation: ThemeElevation = {
  none: NO_SHADOW,
  card: NO_SHADOW,
  raised: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
};

const scales = {
  spacing,
  radii,
  typography,
  iconSizes,
  controlHeights,
} as const;

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: lightColors,
  chart: lightChart,
  elevation: lightElevation,
  ...scales,
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: darkColors,
  chart: darkChart,
  elevation: darkElevation,
  ...scales,
};
