import {
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryMeta,
} from '@reduxjs/toolkit/query/react';

import {
  configError,
  fromFetchBaseQueryError,
  type AppError,
} from '../../utils/errors';
import { logger } from '../../utils/logger';
import { createRequestId } from './requestId';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface ApiSettings {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch;
}

export type AppBaseQuery = BaseQueryFn<
  string | FetchArgs,
  unknown,
  AppError,
  object,
  FetchBaseQueryMeta
>;

type RawBaseQuery = ReturnType<typeof fetchBaseQuery>;

/**
 * The single HTTP entry point for the app. Every RTK Query endpoint goes through it, so
 * cross-cutting behavior lives in one place:
 *
 * - base URL and timeout from environment configuration (resolved lazily, so an invalid
 *   configuration surfaces as an error instead of crashing at import time)
 * - `Accept` and `X-Request-Id` headers on every request
 * - every failure normalized into an AppError
 *
 * Version 2 adds the Authorization header and one-shot token refresh here.
 */
export function createBaseQuery(
  resolveSettings: () => ApiSettings,
): AppBaseQuery {
  let rawBaseQuery: RawBaseQuery | undefined;

  return async (args, api, extraOptions) => {
    if (rawBaseQuery === undefined) {
      let settings: ApiSettings;
      try {
        settings = resolveSettings();
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return { error: configError(detail) };
      }
      rawBaseQuery = fetchBaseQuery({
        baseUrl: settings.baseUrl,
        timeout: settings.timeoutMs,
        ...(settings.fetchFn !== undefined && { fetchFn: settings.fetchFn }),
        prepareHeaders: headers => {
          headers.set('Accept', 'application/json');
          headers.set(REQUEST_ID_HEADER, createRequestId());
          return headers;
        },
      });
    }

    const result = await rawBaseQuery(args, api, extraOptions);
    if (result.error === undefined) {
      return result;
    }

    const requestId =
      result.meta?.request.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const error = fromFetchBaseQueryError(result.error, requestId);
    logger.warn('API request failed', {
      endpoint: api.endpoint,
      kind: error.kind,
      status: error.status,
      requestId: error.requestId,
    });
    return result.meta === undefined ? { error } : { error, meta: result.meta };
  };
}
