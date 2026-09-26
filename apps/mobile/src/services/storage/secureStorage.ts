import * as Keychain from 'react-native-keychain';

/**
 * Secure storage for credentials, backed by the Android Keystore (react-native-keychain).
 *
 * The value is encrypted with an AES-GCM key that lives in the Keystore (hardware-backed
 * where the device supports it) and never leaves it; only ciphertext is written to app
 * storage. `android:allowBackup="false"` keeps it out of device backups.
 *
 * Use it for: session credentials only. Everything else belongs in MMKV (preferences) or
 * SQLite (domain data, Version 5). See docs/mobile-architecture.md.
 */
export interface SecureValueStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** One Keychain "service" per stored secret. */
const SESSION_SERVICE = 'com.fieldops.mobile.session';
/** The Keychain API stores username/password pairs; the username is unused. */
const ACCOUNT = 'fieldops';

export const secureSessionStorage: SecureValueStore = {
  async get() {
    const credentials = await Keychain.getGenericPassword({
      service: SESSION_SERVICE,
    });
    return credentials === false ? null : credentials.password;
  },
  async set(value) {
    const result = await Keychain.setGenericPassword(ACCOUNT, value, {
      service: SESSION_SERVICE,
      // Encrypt with a Keystore key that needs no biometric prompt: the app must be able
      // to refresh tokens in the background.
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (result === false) {
      throw new Error('Secure storage rejected the value');
    }
  },
  async clear() {
    await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
  },
};
