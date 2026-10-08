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
  // Evidence written by the E2E tests; emptied by the tests that use it (gitignored).
  STORAGE_DIR: './test-storage',
  // Evidence goes to an S3-compatible bucket instead when TEST_S3_ENDPOINT is set (the
  // S3Mock compose service: http://localhost:9090), the path Cloudflare R2 takes in
  // deployments. S3Mock accepts any credentials.
  STORAGE_DRIVER:
    process.env['TEST_S3_ENDPOINT'] === undefined ? 'local' : 's3',
  S3_ENDPOINT: process.env['TEST_S3_ENDPOINT'] ?? '',
  S3_REGION: 'auto',
  S3_BUCKET: process.env['TEST_S3_BUCKET'] ?? 'fieldops-evidence',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  // Push goes to a recording fake in tests (test/helpers/test-app.ts).
  FCM_SERVICE_ACCOUNT_FILE: '',
  // The overdue scan is run explicitly by the tests that need it.
  OVERDUE_SCAN_INTERVAL: 'off',
  // Redis is optional: set TEST_REDIS_URL to run the suite (and test/redis.e2e-spec.ts)
  // against one. Test keys get their own prefix and are flushed by the tests that use them.
  REDIS_URL: process.env['TEST_REDIS_URL'] ?? '',
  REDIS_KEY_PREFIX: 'fieldops-test:',
  // The suite signs in far more often than the policies allow; the rate-limit tests turn
  // limiting on with their own small policies.
  RATE_LIMIT_ENABLED: 'false',
} as const;
