/**
 * @jest-environment node
 */
import type { BaseQueryApi } from '@reduxjs/toolkit/query';

import { createBaseQuery, REQUEST_ID_HEADER } from './baseQuery';

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

  it('maps HTTP errors with Problem Details', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(503, { title: 'Service Unavailable', code: 'MAINTENANCE' }),
    );
    const baseQuery = createBaseQuery(() => ({
      baseUrl: 'https://api.example.com',
      timeoutMs: 5000,
      fetchFn: fetchFn as unknown as typeof fetch,
    }));

    const result = await baseQuery('/api/v1/jobs', api, {});

    expect(result.error).toMatchObject({
      kind: 'http',
      status: 503,
      message: 'Service Unavailable',
      code: 'MAINTENANCE',
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
});
