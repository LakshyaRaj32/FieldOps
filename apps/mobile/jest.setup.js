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
