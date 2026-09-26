import { defineConfig } from 'vitest/config';

/** Unit tests: next to the code (src/**\/*.spec.ts). No database, no network. */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
