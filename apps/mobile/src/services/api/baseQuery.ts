import {
  fetchBaseQuery,
  type BaseQueryApi,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryMeta,
} from '@reduxjs/toolkit/query/react';
import type { AuthTokens } from '@fieldops/types';

import {
  configError,
  fromFetchBaseQueryError,
  type AppError,
} from '../../utils/errors';
import { logger } from '../../utils/logger';
import { isAuthTokens } from '../auth/contracts';
import { createRequestId } from './requestId';

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REFRESH_PATH = '/api/v1/auth/refresh';

export interface ApiSettings {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch;
}

/**
 * How the base query reaches the session. Provided per request (from the store's thunk
 * extra argument) so the HTTP layer never imports the store or secure storage directly.
 */
export interface BaseQueryAuth {
  getAccessToken(): string | undefined;
  getRefreshToken(): string | undefined;
  /** Persists a rotated token pair. */
  onTokensRefreshed(tokens: AuthTokens): Promise<void>;
  /** The server ended the session (refresh rejected): clear credentials, go to sign-in. */
  onSessionEnded(api: BaseQueryApi): Promise<void>;
}

export type AppBaseQuery = BaseQueryFn<
  string | FetchArgs,
  unknown,
  AppError,
  object,
  FetchBaseQueryMeta
>;

type RawBaseQuery = ReturnType<typeof fetchBaseQuery>;
type RawResult = Awaited<ReturnType<RawBaseQuery>>;

/** Outcome of a refresh attempt. `failed` = transient (offline, 5xx): keep the session. */
type RefreshOutcome = 'refreshed' | 'rejected' | 'failed';

/** Unwraps the API success envelope `{ success: true, data }`; other bodies pass through. */
function unwrapEnvelope(body: unknown): unknown {
  if (typeof body === 'object' && body !== null) {
    const { success, data } = body as Record<string, unknown>;
    if (success === true) {
      return data;
    }
  }
  return body;
}

function withAuthorization(
  args: string | FetchArgs,
  token: string | undefined,
): string | FetchArgs {
  if (token === undefined) {
    return args;
  }
  const fetchArgs = typeof args === 'string' ? { url: args } : args;
  const headers = new Headers(
    fetchArgs.headers as ConstructorParameters<typeof Headers>[0],
  );
  headers.set('Authorization', `Bearer ${token}`);
  return { ...fetchArgs, headers };
}

/**
 * The single HTTP entry point for the app. Every RTK Query endpoint goes through it, so
 * cross-cutting behavior lives in one place:
 *
 * - base URL and timeout from environment configuration (resolved lazily, so an invalid
 *   configuration surfaces as an error instead of crashing at import time)
 * - `Accept`, `X-Request-Id` and (when signed in) `Authorization` headers
 * - unwrapping of the `{ success: true, data }` envelope
 * - token refresh: a 401 on an authenticated request triggers ONE refresh shared by all
 *   concurrent requests (single flight), then the request is retried once. The server
 *   treats two refreshes with the same token as token theft, so this must never race.
 * - every failure normalized into an AppError
 */
export function createBaseQuery(
  resolveSettings: () => ApiSettings,
  resolveAuth: (api: BaseQueryApi) => BaseQueryAuth | undefined = () =>
    undefined,
): AppBaseQuery {
  let rawBaseQuery: RawBaseQuery | undefined;
  let refreshInFlight: Promise<RefreshOutcome> | undefined;

  async function refreshTokens(
    auth: BaseQueryAuth,
    api: BaseQueryApi,
    rawQuery: RawBaseQuery,
  ): Promise<RefreshOutcome> {
    refreshInFlight ??= (async (): Promise<RefreshOutcome> => {
      const refreshToken = auth.getRefreshToken();
      if (refreshToken === undefined) {
        return 'rejected';
      }
      // Sent without the (expired) access token.
      const result = await rawQuery(
        { url: REFRESH_PATH, method: 'POST', body: { refreshToken } },
        api,
        {},
      );
      if (result.error !== undefined) {
        const { status } = result.error;
        // 4xx: the server refused this refresh token for good. Anything else (offline,
        // timeout, 5xx) is transient: keep the session and let the user retry.
        const rejected = typeof status === 'number' && status < 500;
        logger.warn('Token refresh failed', {
          status,
          rejected,
          requestId:
            result.meta?.request.headers.get(REQUEST_ID_HEADER) ?? undefined,
        });
        return rejected ? 'rejected' : 'failed';
      }
      const tokens = unwrapEnvelope(result.data);
      if (!isAuthTokens(tokens)) {
        logger.warn('Token refresh returned an unexpected body');
        return 'failed';
      }
      await auth.onTokensRefreshed(tokens);
      return 'refreshed';
    })().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  }

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
    const raw = rawBaseQuery;
    const auth = resolveAuth(api);

    // The token is attached to this request's own arguments, so concurrent requests
    // never share header state.
    const send = async (): Promise<{ result: RawResult; token?: string }> => {
      const token = auth?.getAccessToken();
      const result = await raw(
        withAuthorization(args, token),
        api,
        extraOptions,
      );
      return token === undefined ? { result } : { result, token };
    };

    const first = await send();
    const sentToken = first.token;
    let { result } = first;

    const currentToken = auth?.getAccessToken();
    // currentToken is undefined when the session ended while this request was in flight:
    // nothing to refresh, nothing to retry.
    if (
      auth !== undefined &&
      sentToken !== undefined &&
      currentToken !== undefined &&
      result.error?.status === 401
    ) {
      // Another request may already have refreshed while this one was in flight.
      const outcome =
        currentToken !== sentToken
          ? 'refreshed'
          : await refreshTokens(auth, api, raw);
      if (outcome === 'refreshed') {
        ({ result } = await send());
      } else if (outcome === 'rejected') {
        await auth.onSessionEnded(api);
      }
    }

    if (result.error === undefined) {
      return {
        data: unwrapEnvelope(result.data),
        ...(result.meta !== undefined && { meta: result.meta }),
      };
    }

    const requestId =
      result.meta?.request.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const error = fromFetchBaseQueryError(result.error, requestId);
    logger.warn('API request failed', {
      endpoint: api.endpoint,
      kind: error.kind,
      status: error.status,
      code: error.code,
      requestId: error.requestId,
    });
    return result.meta === undefined ? { error } : { error, meta: result.meta };
  };
}
