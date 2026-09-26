import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { TEST_ENV } from './test/test-env.js';

/**
 * End-to-end tests: the real Nest application over HTTP (supertest) against a real
 * PostgreSQL test database. The database is never mocked (docs/backend-architecture.md).
 */
export default defineConfig({
  // Tests run the shared package's TypeScript source; only the built API loads its dist/.
  resolve: {
    alias: {
      '@fieldops/shared': fileURLToPath(
        new URL(
          '../../packages/shared/src/job-state-machine.ts',
          import.meta.url,
        ),
      ),
    },
  },
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
