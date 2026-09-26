import type { SqlDatabase } from './database';

/**
 * Forward-only schema migrations for a local SQLite database.
 *
 * The schema version is SQLite's `PRAGMA user_version` (0 for a new file). Each migration
 * runs in its own transaction together with the version bump, so a failure leaves the
 * database exactly at the previous version: the outbox is never lost to a half-applied
 * migration, and the next start retries.
 *
 * Adding a change: append a migration with the next version. Never edit or reorder a
 * released migration; devices in the field have already applied it.
 */
export interface Migration {
  readonly version: number;
  readonly description: string;
  readonly statements: readonly string[];
}

export async function currentVersion(db: SqlDatabase): Promise<number> {
  const [row] = await db.all('PRAGMA user_version');
  const { user_version: version } = row ?? {};
  return typeof version === 'number' ? version : 0;
}

/** Applies every migration newer than the database. Returns the resulting version. */
export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[],
): Promise<number> {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 1, 2, 3... (found ${
          migration.version
        } at position ${index + 1})`,
      );
    }
  });

  let version = await currentVersion(db);
  if (version > migrations.length) {
    // A newer app wrote this database; an older one must not guess at its schema.
    throw new Error(
      `Local database version ${version} is newer than this app (${migrations.length})`,
    );
  }
  for (const migration of migrations.slice(version)) {
    await db.transaction(tx => {
      for (const statement of migration.statements) {
        tx.run(statement);
      }
      // PRAGMA takes no bound parameters; the version is a validated integer.
      tx.run(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
  return version;
}
