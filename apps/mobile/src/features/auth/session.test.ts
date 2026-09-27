/**
 * @jest-environment node
 */
import { Role, type AuthResult } from '@fieldops/types';

import type { SecureValueStore } from '../../services/storage/secureStorage';
import { createCredentialStore } from '../../services/auth/credentialStore';
import { createAppStore } from '../../store';
import { authApi } from './api/authApi';
import { restoreSession, signOut } from './session';

const authResult: AuthResult = {
  user: {
    id: 'user-1',
    email: 'asha@example.com',
    firstName: 'Asha',
    lastName: 'Verma',
    role: Role.WORKER,
    isActive: true,
    organization: null,
    organizationWideAccess: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  tokens: {
    tokenType: 'Bearer',
    accessToken: 'access-token-secret-value',
    accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
    refreshToken: 'refresh-token-secret-value',
    refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function memoryStorage(): SecureValueStore & { value: string | null } {
  return {
    value: null,
    async get() {
      return this.value;
    },
    async set(next) {
      this.value = next;
    },
    async clear() {
      this.value = null;
    },
  };
}

type Route = (request: Request) => Response | Promise<Response>;

function setup(routes: Record<string, Route>) {
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input.toString(), init);
      const path = new URL(request.url).pathname;
      const route = routes[`${request.method} ${path}`];
      return route === undefined ? jsonResponse(404, {}) : route(request);
    },
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const storage = memoryStorage();
  const credentials = createCredentialStore(storage);
  const store = createAppStore({ services: { credentials } });
  return { store, credentials, storage, fetchMock };
}

let warnSpy: jest.SpyInstance;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
  });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe('sign-in', () => {
  it('stores tokens in the credential store and only the user in Redux', async () => {
    const { store, credentials, storage } = setup({
      'POST /api/v1/auth/login': () =>
        jsonResponse(200, { success: true, data: authResult }),
    });
    store.dispatch({ type: 'session/signedOut' });

    const result = await store.dispatch(
      authApi.endpoints.login.initiate(
        { email: 'asha@example.com', password: 'correct horse' },
        { track: false },
      ),
    );

    expect(result.data).toEqual(authResult.user);
    expect(store.getState().session).toEqual({
      status: 'signedIn',
      user: authResult.user,
    });
    expect(credentials.getAccessToken()).toBe('access-token-secret-value');
    expect(storage.value).toContain('refresh-token-secret-value');
    // The whole Redux state (including the RTK Query cache) never sees a token.
    const state = JSON.stringify(store.getState());
    expect(state).not.toContain('access-token-secret-value');
    expect(state).not.toContain('refresh-token-secret-value');
    expect(state).not.toContain('correct horse');
  });

  it('stays signed out and exposes the error when credentials are wrong', async () => {
    const { store, credentials } = setup({
      'POST /api/v1/auth/login': () =>
        jsonResponse(401, {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          },
        }),
    });
    store.dispatch({ type: 'session/signedOut' });

    const result = await store.dispatch(
      authApi.endpoints.login.initiate(
        { email: 'a@b.co', password: 'wrong' },
        { track: false },
      ),
    );

    expect(result.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Incorrect email or password.',
    });
    expect(store.getState().session.status).toBe('signedOut');
    expect(credentials.getAccessToken()).toBeUndefined();
  });
});

describe('restoreSession', () => {
  it('signs out when nothing is stored', async () => {
    const { store } = setup({});

    await store.dispatch(restoreSession());

    expect(store.getState().session).toEqual({ status: 'signedOut' });
  });

  it('opens signed in from storage and refreshes the profile from the server', async () => {
    const { store, credentials, fetchMock } = setup({
      'GET /api/v1/auth/me': request =>
        request.headers.get('Authorization') ===
        'Bearer access-token-secret-value'
          ? jsonResponse(200, {
              success: true,
              data: { ...authResult.user, role: Role.MANAGER },
            })
          : jsonResponse(401, {}),
    });
    await credentials.save(authResult);

    await store.dispatch(restoreSession());

    expect(fetchMock).toHaveBeenCalled();
    expect(store.getState().session).toMatchObject({
      status: 'signedIn',
      user: { role: Role.MANAGER },
    });
  });

  it('stays signed in with the stored profile when the server is unreachable', async () => {
    const { store, credentials } = setup({
      'GET /api/v1/auth/me': () => {
        throw new TypeError('Network request failed');
      },
    });
    await credentials.save(authResult);

    await store.dispatch(restoreSession());

    expect(store.getState().session).toEqual({
      status: 'signedIn',
      user: authResult.user,
    });
  });

  it('signs out when the refresh token is rejected (session ended on the server)', async () => {
    const { store, credentials } = setup({
      'GET /api/v1/auth/me': () =>
        jsonResponse(401, {
          success: false,
          error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'expired' },
        }),
      'POST /api/v1/auth/refresh': () =>
        jsonResponse(401, {
          success: false,
          error: { code: 'SESSION_REVOKED', message: 'revoked' },
        }),
    });
    await credentials.save(authResult);

    await store.dispatch(restoreSession());

    expect(store.getState().session).toEqual({
      status: 'signedOut',
      reason: 'sessionEnded',
    });
    expect(credentials.getRefreshToken()).toBeUndefined();
  });
});

describe('signOut', () => {
  it('revokes the server session, then clears credentials and state', async () => {
    const logout = jest.fn(() => jsonResponse(204, null));
    const { store, credentials, storage } = setup({
      'POST /api/v1/auth/logout': logout,
    });
    await credentials.save(authResult);
    store.dispatch({ type: 'session/signedIn', payload: authResult.user });

    await store.dispatch(signOut());

    expect(logout).toHaveBeenCalledTimes(1);
    expect(store.getState().session).toEqual({
      status: 'signedOut',
      reason: 'signedOut',
    });
    expect(storage.value).toBeNull();
  });

  it('signs out locally even when the server cannot be reached', async () => {
    const { store, credentials } = setup({
      'POST /api/v1/auth/logout': () => {
        throw new TypeError('Network request failed');
      },
    });
    await credentials.save(authResult);

    await store.dispatch(signOut());

    expect(store.getState().session.status).toBe('signedOut');
    expect(credentials.getAccessToken()).toBeUndefined();
  });
});
