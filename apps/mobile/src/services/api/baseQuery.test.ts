/**
 * @jest-environment node
 */
import type { BaseQueryApi } from '@reduxjs/toolkit/query';
import type { AuthTokens } from '@fieldops/types';

import {
  createBaseQuery,
  REFRESH_PATH,
  REQUEST_ID_HEADER,
  type BaseQueryAuth,
} from './baseQuery';

const api: BaseQueryApi = {
  signal: new AbortController().signal,
  abort: () => undefined,
  dispatch: () => undefined,
  getState: () => ({}),
  extra: undefined,
  endpoint: 'testEndpoint',
  type: 'query',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const tokensWith = (suffix: string): AuthTokens => ({
  tokenType: 'Bearer',
  accessToken: `access-${suffix}`,
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: `refresh-${suffix}`,
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
});

/** A mutable session like the real credential store, with spies on the callbacks. */
function fakeAuth(initial: AuthTokens | null = tokensWith('1')) {
  let tokens: AuthTokens | undefined = initial ?? undefined;
  const auth: BaseQueryAuth = {
    getAccessToken: () => tokens?.accessToken,
    getRefreshToken: () => tokens?.refreshToken,
    onTokensRefreshed: jest.fn(async (next: AuthTokens) => {
      tokens = next;
    }),
    onSessionEnded: jest.fn(async () => {
      tokens = undefined;
    }),
  };
  return auth;
}

const expiredError = {
  success: false,
  error: {
    code: 'ACCESS_TOKEN_EXPIRED',
    message: 'The access token has expired.',
  },
};

/** A tiny fake API: /me needs `access-2`; refresh rotates 1 -> 2. */
function fakeServer(refreshResponse: () => Response) {
  return jest.fn(async (request: Request) => {
    if (request.url.endsWith(REFRESH_PATH)) {
      return refreshResponse();
    }
    return request.headers.get('Authorization') === 'Bearer access-2'
      ? jsonResponse(200, { success: true, data: { name: 'Asha' } })
      : jsonResponse(401, expiredError);
  });
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  // fetchBaseQuery's timeout helper starts a timer it never clears (harmless in the app, but
  // it would keep Jest alive). Fake only timers; promises and microtasks stay real.
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
  });
  // Failed requests are logged through logger.warn; capture instead of printing.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('createBaseQuery', () => {
  it('sends requests to the configured base URL with Accept and X-Request-Id headers', async () => {
    const fetchFn = jest.fn(async (_request: Request) =>
      jsonResponse(200, { ok: true }),
    );
    const baseQuery = createBaseQuery(() => ({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }));

    const result = await baseQuery('/health/live', api, {});

    expect(result.data).toEqual({ ok: true });
    const request = fetchFn.mock.calls[0]?.[0];
    expect(request?.url).toBe('https://api.example.com/health/live');
    expect(request?.headers.get('Accept')).toBe('application/json');
    expect(request?.headers.get(REQUEST_ID_HEADER)).toMatch(
      /^[a-z0-9]+-[a-z0-9]{8}$/,
    );
    expect(request?.headers.get('Authorization')).toBeNull();
  });

  it('unwraps the { success: true, data } envelope', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, { success: true, data: { status: 'ok' } }),
    );
    const baseQuery = createBaseQuery(() => ({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }));

    expect((await baseQuery('/health/live', api, {})).data).toEqual({
      status: 'ok',
    });
  });

  it('returns a network AppError carrying the request ID when the server is unreachable', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const baseQuery = createBaseQuery(() => ({
      baseUrl: 'http://localhost:3000',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }));

    const result = await baseQuery('/health/live', api, {});

    expect(result.error).toMatchObject({ kind: 'network' });
    expect(result.error?.requestId).toMatch(/^[a-z0-9]+-[a-z0-9]{8}$/);
    // Failures are never silent: they are logged with the correlation ID.
    expect(warnSpy).toHaveBeenCalledWith(
      '[FieldOps] API request failed',
      expect.objectContaining({
        kind: 'network',
        requestId: result.error?.requestId,
      }),
    );
  });

  it('maps API error envelopes to app-owned messages and codes', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(409, {
        success: false,
        error: {
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists.',
          requestId: 'server-req-1',
        },
      }),
    );
    const baseQuery = createBaseQuery(() => ({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }));

    const result = await baseQuery('/api/v1/auth/register', api, {});

    expect(result.error).toMatchObject({
      kind: 'http',
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
      message:
        'An account with this email already exists. Try signing in instead.',
      requestId: 'server-req-1',
    });
  });

  it('returns a config AppError instead of throwing when configuration is invalid', async () => {
    const baseQuery = createBaseQuery(() => {
      throw new Error('APP_ENV is missing.');
    });

    const result = await baseQuery('/health/live', api, {});

    expect(result.error).toMatchObject({
      kind: 'config',
      detail: 'APP_ENV is missing.',
    });
  });

  describe('authentication', () => {
    const settings = (fetchFn: jest.Mock) => () => ({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    it('sends the access token as a Bearer header', async () => {
      const fetchFn = jest.fn(async (_request: Request) =>
        jsonResponse(200, { success: true, data: {} }),
      );
      const auth = fakeAuth(tokensWith('2'));
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      await baseQuery('/api/v1/auth/me', api, {});

      expect(fetchFn.mock.calls[0]?.[0].headers.get('Authorization')).toBe(
        'Bearer access-2',
      );
    });

    it('refreshes an expired access token once, persists the new pair and retries', async () => {
      const fetchFn = fakeServer(() =>
        jsonResponse(200, { success: true, data: tokensWith('2') }),
      );
      const auth = fakeAuth();
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      const result = await baseQuery('/api/v1/auth/me', api, {});

      expect(result.data).toEqual({ name: 'Asha' });
      expect(auth.onTokensRefreshed).toHaveBeenCalledWith(tokensWith('2'));
      const refreshCall = fetchFn.mock.calls
        .map(([request]) => request)
        .find(request => request.url.endsWith(REFRESH_PATH));
      // The refresh request carries the refresh token in the body, not the access token.
      expect(refreshCall?.headers.get('Authorization')).toBeNull();
      expect(await refreshCall?.clone().json()).toEqual({
        refreshToken: 'refresh-1',
      });
    });

    it('shares one refresh between concurrent requests (single flight)', async () => {
      const fetchFn = fakeServer(() =>
        jsonResponse(200, { success: true, data: tokensWith('2') }),
      );
      const auth = fakeAuth();
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      const results = await Promise.all([
        baseQuery('/api/v1/auth/me', api, {}),
        baseQuery('/api/v1/auth/me', api, {}),
        baseQuery('/api/v1/auth/me', api, {}),
      ]);

      expect(results.every(result => result.data !== undefined)).toBe(true);
      const refreshCalls = fetchFn.mock.calls.filter(([request]) =>
        request.url.endsWith(REFRESH_PATH),
      );
      expect(refreshCalls).toHaveLength(1);
    });

    it('ends the session when the server rejects the refresh token', async () => {
      const fetchFn = fakeServer(() =>
        jsonResponse(401, {
          success: false,
          error: { code: 'SESSION_REVOKED', message: 'Signed out.' },
        }),
      );
      const auth = fakeAuth();
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      const result = await baseQuery('/api/v1/auth/me', api, {});

      expect(auth.onSessionEnded).toHaveBeenCalledTimes(1);
      expect(result.error).toMatchObject({ status: 401 });
      // No retry after a rejected refresh: /me + refresh only.
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('keeps the session when the refresh fails for a transient reason (offline)', async () => {
      const fetchFn = jest.fn(async (request: Request) => {
        if (request.url.endsWith(REFRESH_PATH)) {
          throw new TypeError('Network request failed');
        }
        return jsonResponse(401, expiredError);
      });
      const auth = fakeAuth();
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      const result = await baseQuery('/api/v1/auth/me', api, {});

      expect(auth.onSessionEnded).not.toHaveBeenCalled();
      expect(auth.getRefreshToken()).toBe('refresh-1');
      expect(result.error).toMatchObject({ kind: 'http', status: 401 });
    });

    it('never tries to refresh requests sent without a token (for example sign-in)', async () => {
      const fetchFn = jest.fn(async () =>
        jsonResponse(401, {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          },
        }),
      );
      const auth = fakeAuth(null);
      const baseQuery = createBaseQuery(settings(fetchFn), () => auth);

      const result = await baseQuery(
        { url: '/api/v1/auth/login', method: 'POST', body: {} },
        api,
        {},
      );

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(auth.onSessionEnded).not.toHaveBeenCalled();
    });
  });
});
