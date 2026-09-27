import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** The shared package's TypeScript source, per entry point (exact matches only). */
export const sharedSourceAliases = [
  {
    find: /^@fieldops\/shared$/,
    replacement: fileURLToPath(
      new URL('../../packages/shared/src/job-state-machine.ts', import.meta.url),
    ),
  },
  {
    find: /^@fieldops\/shared\/geo$/,
    replacement: fileURLToPath(
      new URL('../../packages/shared/src/geo.ts', import.meta.url),
    ),
  },
  {
    find: /^@fieldops\/shared\/requirements$/,
    replacement: fileURLToPath(
      new URL(
        '../../packages/shared/src/operation-requirements.ts',
        import.meta.url,
      ),
    ),
  },
  {
    find: /^@fieldops\/shared\/money$/,
    replacement: fileURLToPath(
      new URL('../../packages/shared/src/money.ts', import.meta.url),
    ),
  },
];

/** Unit tests: next to the code (src/**\/*.spec.ts). No database, no network. */
export default defineConfig({
  // Tests run the shared package's TypeScript source; only the built API loads its dist/.
  resolve: { alias: sharedSourceAliases },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
