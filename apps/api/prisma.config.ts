import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files itself. Local development keeps DATABASE_URL in
// apps/api/.env; deployed environments (and the E2E setup) set it directly, and an explicit
// value always wins over the file.
if (process.env['DATABASE_URL'] === undefined) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the process environment.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not need a database, so DATABASE_URL may be absent on a fresh
  // clone. Commands that connect (migrate, studio) fail with a clear error if it is missing.
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
