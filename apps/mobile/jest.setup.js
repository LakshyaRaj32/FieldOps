/**
 * Jest setup. Native modules do not exist in the Node test environment, so modules that are
 * imported indirectly by code under test are replaced with deterministic fakes here.
 * Tests should target pure logic; add a mock only when a native import is unavoidable.
 */

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    APP_ENV: 'development',
    API_BASE_URL: 'http://localhost:3000',
    API_TIMEOUT_MS: '15000',
  },
}));
