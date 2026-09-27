/**
 * Jest setup. Native modules do not exist in the Node test environment, so modules that are
 * imported indirectly by code under test are replaced with deterministic fakes here.
 * Tests should target pure logic; add a mock only when a native import is unavoidable.
 */

// Secure storage (Android Keystore) as an in-memory map. Tests that exercise credentials
// directly use createCredentialStore with their own fake instead.
jest.mock('react-native-keychain', () => {
  const items = new Map();
  return {
    STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    getGenericPassword: jest.fn(
      async ({ service }) => items.get(service) ?? false,
    ),
    setGenericPassword: jest.fn(async (username, password, { service }) => {
      items.set(service, {
        username,
        password,
        service,
        storage: 'KeystoreAESGCM_NoAuth',
      });
      return { service, storage: 'KeystoreAESGCM_NoAuth' };
    }),
    resetGenericPassword: jest.fn(async ({ service }) => items.delete(service)),
  };
});

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    APP_ENV: 'development',
    API_BASE_URL: 'http://localhost:3000',
    API_TIMEOUT_MS: '15000',
  },
}));

// Push (React Native Firebase): no Firebase app in tests, so push reports "unavailable".
jest.mock('@react-native-firebase/app', () => ({ getApps: () => [] }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  deleteToken: jest.fn(),
  onMessage: jest.fn(() => () => undefined),
  onTokenRefresh: jest.fn(() => () => undefined),
  onNotificationOpenedApp: jest.fn(() => () => undefined),
  getInitialNotification: jest.fn(async () => null),
  setBackgroundMessageHandler: jest.fn(),
}));

// The image picker opens native activities; tests of photoPicker drive toPickResult directly.
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(async () => ({ didCancel: true })),
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));
