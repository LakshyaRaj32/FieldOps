import type { SqlDatabase, SqlRow, SqlValue } from '../services/db/database';

/**
 * Test implementation of SqlDatabase on Node's built-in SQLite (`node:sqlite`, Node 22.5+),
 * so the data layer and sync engine are tested against a real SQLite engine with no extra
 * dependency. Pass a file path to test app restarts (close, then open the same file again).
 * Never imported by app code.
 */

interface Statement {
  all(...params: SqlValue[]): SqlRow[];
  run(...params: SqlValue[]): unknown;
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

type DatabaseSyncConstructor = new (path: string) => DatabaseSync;

function loadDatabaseSync(): DatabaseSyncConstructor {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sqlite = require('node:sqlite') as {
    DatabaseSync: DatabaseSyncConstructor;
  };
  return sqlite.DatabaseSync;
}

export function openNodeSqliteDatabase(path = ':memory:'): SqlDatabase {
  const DatabaseSyncClass = loadDatabaseSync();
  const db = new DatabaseSyncClass(path);
  let open = true;
  let inTransaction = false;
  const executor = {
    all: (sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params),
    run: (sql: string, params: readonly SqlValue[] = []) => {
      db.prepare(sql).run(...params);
    },
  };
  const assertOpen = () => {
    if (!open) {
      throw new Error('Database is closed');
    }
  };

  return {
    async all(sql, params) {
      assertOpen();
      return executor.all(sql, params);
    },
    async transaction(work) {
      assertOpen();
      if (inTransaction) {
        throw new Error('Nested transaction');
      }
      inTransaction = true;
      db.exec('BEGIN');
      try {
        const result = work(executor);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() {
      open = false;
      db.close();
    },
    destroy() {
      open = false;
      db.close();
    },
  };
}
