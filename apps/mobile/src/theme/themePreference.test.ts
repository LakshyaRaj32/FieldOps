import { parseThemePreference, resolveTheme } from './themePreference';
import { darkTheme, lightTheme } from './themes';

describe('parseThemePreference', () => {
  it('accepts stored preferences', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
  });

  it('falls back to system for missing or corrupted values', () => {
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference('purple')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('follows the OS when the preference is system', () => {
    expect(resolveTheme('system', 'dark')).toBe(darkTheme);
    expect(resolveTheme('system', 'light')).toBe(lightTheme);
    expect(resolveTheme('system', null)).toBe(lightTheme);
    expect(resolveTheme('system', 'unspecified')).toBe(lightTheme);
  });

  it('lets an explicit preference override the OS', () => {
    expect(resolveTheme('light', 'dark')).toBe(lightTheme);
    expect(resolveTheme('dark', 'light')).toBe(darkTheme);
  });
});
