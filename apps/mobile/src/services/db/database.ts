/**
 * The app's view of a SQLite database. Two implementations exist: the device one
 * (nitroDatabase.ts, react-native-nitro-sqlite) and a test one on Node's built-in SQLite
 * (src/testing/nodeSqliteDatabase.ts), so repositories and the sync engine are tested
 * against a real SQLite engine.
 *
 * Deliberately small:
 * - reads are asynchronous (queued behind any running transaction);
 * - every write happens inside `transaction`, whose work is synchronous: all statements of
 *   one unit (a domain change and its outbox entry, a pulled snapshot) commit or roll back
 *   together, and nothing can interleave with them.
 */

export type SqlValue = string | number | null;

export type SqlRow = Readonly<Record<string, SqlValue>>;

/** Statement execution inside a transaction. */
export interface SqlTransaction {
  all(sql: string, params?: readonly SqlValue[]): SqlRow[];
  run(sql: string, params?: readonly SqlValue[]): void;
}

export interface SqlDatabase {
  all(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  /**
   * Runs `work` in one transaction: committed if it returns, rolled back if it throws (the
   * error is rethrown). `work` must not await anything.
   */
  transaction<Result>(work: (tx: SqlTransaction) => Result): Promise<Result>;
  close(): void;
  /** Closes the connection and deletes the database file. */
  destroy(): void;
}

/** Reads a column that the schema declares NOT NULL TEXT. */
export function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`Column ${column} is not text`);
  }
  return value;
}

export function optionalText(row: SqlRow, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' ? value : null;
}

export function integer(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number') {
    throw new Error(`Column ${column} is not a number`);
  }
  return value;
}
