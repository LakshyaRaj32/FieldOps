/**
 * Opaque keyset cursor for lists ordered by (timestamp, id): the sort key of the last item on
 * a page, so the next page starts right after it even when rows are added in between.
 * Clients treat it as an opaque string. (Job lists have their own, on the scheduled time.)
 */
export interface Cursor {
  readonly at: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify([cursor.at.toISOString(), cursor.id]),
  ).toString('base64url');
}

/** Returns undefined for anything that is not a cursor this API produced. */
export function decodeCursor(value: string): Cursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return undefined;
  }
  const [at, id] = parsed as unknown[];
  if (typeof at !== 'string' || typeof id !== 'string') {
    return undefined;
  }
  const date = new Date(at);
  return Number.isNaN(date.getTime()) || !UUID.test(id)
    ? undefined
    : { at: date, id };
}
