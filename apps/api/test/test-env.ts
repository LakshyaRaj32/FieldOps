/**
 * Environment for E2E tests, shared by vitest.config.e2e.ts (test workers) and
 * global-setup.ts (migrations). Test-only values, not secrets.
 *
 * The test database is separate from the development database and is wiped between tests.
 * Override it with TEST_DATABASE_URL; its name must end in "_test".
 */
export const TEST_ENV = {
  APP_ENV: 'development',
  DATABASE_URL:
    process.env['TEST_DATABASE_URL'] ??
    'postgresql://fieldops:fieldops@localhost:5432/fieldops_test',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdefghijklmno',
  ACCESS_TOKEN_EXPIRATION: '15m',
  REFRESH_TOKEN_EXPIRATION: '30d',
  CORS_ORIGINS: '',
  SWAGGER_ENABLED: 'false',
} as const;
