import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Unit tests: next to the code (src/**\/*.spec.ts). No database, no network. */
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
    include: ['src/**/*.spec.ts'],
  },
});
