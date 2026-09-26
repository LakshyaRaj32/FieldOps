/**
 * Opaque keyset cursor for job lists ordered by (scheduledAt, id). It encodes the sort key of
 * the last item on a page, so the next page starts right after it even when jobs are created
 * or deleted in between (unlike offsets). Clients treat it as an opaque string.
 */
export interface JobCursor {
  readonly scheduledAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeJobCursor(cursor: JobCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.scheduledAt.toISOString(), cursor.id]),
  ).toString('base64url');
}

/** Returns undefined for anything that is not a cursor this API produced. */
export function decodeJobCursor(value: string): JobCursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return undefined;
  }
  const [scheduledAt, id] = parsed as unknown[];
  if (typeof scheduledAt !== 'string' || typeof id !== 'string') {
    return undefined;
  }
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime()) || !UUID.test(id)) {
    return undefined;
  }
  return { scheduledAt: date, id };
}
