import { defineConfig } from 'vitest/config';

import { TEST_ENV } from './test/test-env.js';

/**
 * End-to-end tests: the real Nest application over HTTP (supertest) against a real
 * PostgreSQL test database. The database is never mocked (docs/backend-architecture.md).
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // One shared database: run test files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { ...TEST_ENV },
  },
});
