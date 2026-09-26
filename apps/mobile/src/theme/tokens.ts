/**
 * Design tokens: the raw scales every component draws from. Components never hard-code
 * colors, font sizes or spacing; they read them from the active theme (see themes.ts).
 */

import type { TextStyle } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

type TypographyStyle = Required<
  Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight'>
> &
  Pick<TextStyle, 'letterSpacing' | 'textTransform'>;

export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TypographyStyle>;

export type TypographyVariant = keyof typeof typography;
