import { createMMKV } from 'react-native-mmkv';

/**
 * Small, synchronous key-value storage for device preferences (MMKV).
 *
 * Use it for: UI preferences, flags, lightweight metadata.
 * Do NOT use it for: domain data (SQLite, Version 5), tokens or credentials (secure
 * storage, Version 2), or anything large. See docs/mobile-architecture.md.
 */
const storage = createMMKV({ id: 'fieldops.preferences' });

/** Every key is declared here, so stored data stays discoverable and typo-proof. */
export const PreferenceKeys = {
  themePreference: 'ui.themePreference',
} as const;

export type PreferenceKey =
  (typeof PreferenceKeys)[keyof typeof PreferenceKeys];

export const preferencesStorage = {
  getString(key: PreferenceKey): string | undefined {
    return storage.getString(key);
  },
  setString(key: PreferenceKey, value: string): void {
    storage.set(key, value);
  },
  remove(key: PreferenceKey): void {
    storage.remove(key);
  },
};
