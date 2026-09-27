/**
 * Design tokens: the raw scales every component draws from. Components never hard-code
 * colors, font sizes or spacing; they read them from the active theme (see themes.ts).
 */

import type { TextStyle } from 'react-native';

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Icon sizes: `sm` inline with captions, `md` in buttons and rows, `lg` in headers. */
export const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * Heights of interactive controls (buttons, inputs, pickers). 48 dp is the Android minimum
 * touch target; `sm` is only for secondary actions inside a row that is itself tappable.
 */
export const controlHeights = {
  sm: 40,
  md: 48,
} as const;

type TypographyStyle = Required<
  Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight'>
> &
  Pick<TextStyle, 'letterSpacing' | 'textTransform'>;

/**
 * The type scale, from largest to smallest:
 *
 * | Role            | Variant                    |
 * | --------------- | -------------------------- |
 * | Brand / hero    | `display`                  |
 * | Screen title    | `title`                    |
 * | Section / card  | `heading`                  |
 * | Body            | `body`, `bodyStrong`       |
 * | Secondary text  | `body` or `caption` + tone |
 * | Caption, meta   | `caption`, `captionStrong` |
 * | Overline label  | `label`                    |
 */
export const typography = {
  display: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TypographyStyle>;

export type TypographyVariant = keyof typeof typography;
