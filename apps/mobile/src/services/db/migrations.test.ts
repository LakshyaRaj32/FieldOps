/**
 * @jest-environment node
 */
import { JOB_MIGRATIONS } from '../../features/jobs/data/localSchema';
import { openNodeSqliteDatabase } from '../../testing/nodeSqliteDatabase';
import { currentVersion, migrate, type Migration } from './migrations';

const tables = async (db: ReturnType<typeof openNodeSqliteDatabase>) =>
  (
    await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  ).map(({ name }) => name);

describe('local database migrations', () => {
  it('creates the schema on a new database and records the version', async () => {
    const db = openNodeSqliteDatabase();

    expect(await migrate(db, JOB_MIGRATIONS)).toBe(JOB_MIGRATIONS.length);
    expect(await currentVersion(db)).toBe(JOB_MIGRATIONS.length);
    expect(await tables(db)).toEqual([
      'evidence_files',
      'jobs',
      'outbox',
      'sync_state',
    ]);
  });

  it('does nothing on an up-to-date database', async () => {
    const db = openNodeSqliteDatabase();
    await migrate(db, JOB_MIGRATIONS);

    await expect(migrate(db, JOB_MIGRATIONS)).resolves.toBe(
      JOB_MIGRATIONS.length,
    );
  });

  it('applies only newer migrations and keeps existing data (outbox included)', async () => {
    const db = openNodeSqliteDatabase();
    await migrate(db, JOB_MIGRATIONS);
    await db.transaction(tx =>
      tx.run('INSERT INTO sync_state (key, value) VALUES (?, ?)', ['k', 'v']),
    );
    const next: Migration = {
      version: JOB_MIGRATIONS.length + 1,
      description: 'test column',
      statements: ['ALTER TABLE sync_state ADD COLUMN note TEXT'],
    };

    await migrate(db, [...JOB_MIGRATIONS, next]);

    expect(await db.all('SELECT key, value, note FROM sync_state')).toEqual([
      { key: 'k', value: 'v', note: null },
    ]);
  });

  it('rolls a failing migration back completely and keeps the previous version', async () => {
    const db = openNodeSqliteDatabase();
    await migrate(db, JOB_MIGRATIONS);
    const broken: Migration = {
      version: JOB_MIGRATIONS.length + 1,
      description: 'half valid',
      statements: ['CREATE TABLE extra (id TEXT)', 'THIS IS NOT SQL'],
    };

    await expect(migrate(db, [...JOB_MIGRATIONS, broken])).rejects.toThrow();

    expect(await currentVersion(db)).toBe(JOB_MIGRATIONS.length);
    expect(await tables(db)).not.toContain('extra');
  });

  it('refuses a database written by a newer app version', async () => {
    const db = openNodeSqliteDatabase();
    await db.transaction(tx => tx.run('PRAGMA user_version = 99'));

    await expect(migrate(db, JOB_MIGRATIONS)).rejects.toThrow(/newer/);
  });
});
