import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { TEST_ENV } from './test-env.js';

/**
 * Applies the committed migrations to the test database before any E2E test runs.
 * `migrate deploy` is exactly what staging and production run, so the tests also prove
 * that the migrations apply cleanly.
 */
export default function setup(): void {
  const databaseUrl = TEST_ENV.DATABASE_URL;
  const databaseName = databaseUrl.split('?')[0]?.split('/').pop() ?? '';
  if (!databaseName.endsWith('_test')) {
    // Tests truncate every table; refuse to touch anything that is not a test database.
    throw new Error(
      `Refusing to run E2E tests against "${databaseName}": the database name must end in "_test".`,
    );
  }

  // The package "exports" hide build/, so resolve the CLI through its bin entry.
  const prismaPackage = createRequire(import.meta.url).resolve(
    'prisma/package.json',
  );
  const prismaCli = join(dirname(prismaPackage), 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
