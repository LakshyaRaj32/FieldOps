import type { FetchArgs } from '@reduxjs/toolkit/query/react';

import { parseError, type AppError } from '../../utils/errors';

type SendResult = {
  readonly data?: unknown;
  readonly error?: AppError | undefined;
};

/** The `baseQuery` RTK Query hands to `queryFn` (it may answer synchronously). */
export type SendRequest = (
  args: string | FetchArgs,
) => SendResult | PromiseLike<SendResult>;

/**
 * Sends a request and checks the response body before it enters the cache. A body of the
 * wrong shape becomes a `parse` AppError: an ordinary failed request, so screens show their
 * error state and tags are still invalidated (throwing would skip both).
 */
export async function fetchChecked<T>(
  send: SendRequest,
  args: string | FetchArgs,
  guard: (value: unknown) => value is T,
  what: string,
): Promise<{ data: T } | { error: AppError }> {
  const result = await send(args);
  if (result.error !== undefined) {
    return { error: result.error };
  }
  return guard(result.data)
    ? { data: result.data }
    : { error: parseError(`Unexpected ${what} response`) };
}

/** For endpoints that answer 204 No Content. */
export async function sendEmpty(
  send: SendRequest,
  args: string | FetchArgs,
): Promise<{ data: null } | { error: AppError }> {
  const result = await send(args);
  return result.error !== undefined ? { error: result.error } : { data: null };
}
