import { open } from 'react-native-nitro-sqlite';

import type { SqlDatabase, SqlRow, SqlTransaction, SqlValue } from './database';

type NitroValue = SqlValue | boolean | ArrayBuffer;

/** The app's schema stores only text, numbers and NULL; anything else is a schema bug. */
function toRow(row: Readonly<Record<string, NitroValue>>): SqlRow {
  const result: Record<string, SqlValue> = {};
  for (const [column, value] of Object.entries(row)) {
    if (typeof value === 'boolean') {
      result[column] = value ? 1 : 0;
    } else if (value instanceof ArrayBuffer) {
      throw new Error(`Unexpected BLOB in column ${column}`);
    } else {
      result[column] = value;
    }
  }
  return result;
}

/**
 * The device implementation of SqlDatabase on react-native-nitro-sqlite. This file is the
 * only importer of the library (enforced by ESLint).
 *
 * Reads use the connection's queue (`executeAsync`), so they wait for a running
 * transaction instead of failing: the library's synchronous calls throw while one is active.
 */
export function openNitroDatabase(name: string): SqlDatabase {
  const connection = open({ name });
  const params = (values: readonly SqlValue[] | undefined) =>
    values === undefined ? undefined : [...values];

  return {
    async all(sql, values) {
      const result = await connection.executeAsync(sql, params(values));
      return result.rows._array.map(toRow);
    },
    transaction(work) {
      return connection.transaction(async tx => {
        const executor: SqlTransaction = {
          all: (sql, values) =>
            tx.execute(sql, params(values)).rows._array.map(toRow),
          run: (sql, values) => {
            tx.execute(sql, params(values));
          },
        };
        return work(executor);
      });
    },
    close: () => connection.close(),
    destroy: () => connection.delete(),
  };
}
