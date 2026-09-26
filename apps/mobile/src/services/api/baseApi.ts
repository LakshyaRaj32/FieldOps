import { createApi, type BaseQueryApi } from '@reduxjs/toolkit/query/react';

import { getConfig } from '../../app/config';
import type { CredentialStore } from '../auth/credentialStore';
import { sessionEnded } from '../auth/sessionEvents';
import { createBaseQuery, type BaseQueryAuth } from './baseQuery';

/** Prefix for versioned business endpoints (health checks live outside it). */
export const API_V1 = '/api/v1';

/** Services the store hands to thunks and to the base query (the thunk extra argument). */
export interface StoreServices {
  readonly credentials: CredentialStore;
}

/** Reads the credential store from the thunk extra argument, if the store provides one. */
export function servicesOf(
  api: Pick<BaseQueryApi, 'extra'>,
): StoreServices | undefined {
  const { extra } = api;
  return typeof extra === 'object' && extra !== null && 'credentials' in extra
    ? (extra as StoreServices)
    : undefined;
}

function resolveAuth(api: BaseQueryApi): BaseQueryAuth | undefined {
  const services = servicesOf(api);
  if (services === undefined) {
    return undefined;
  }
  const { credentials } = services;
  return {
    getAccessToken: () => credentials.getAccessToken(),
    getRefreshToken: () => credentials.getRefreshToken(),
    onTokensRefreshed: tokens => credentials.updateTokens(tokens),
    onSessionEnded: async ({ dispatch }) => {
      await credentials.clear();
      dispatch(sessionEnded());
      // Runs at request time, long after baseApi below has been created.
      dispatch(baseApi.util.resetApiState());
    },
  };
}

/**
 * The root RTK Query API. It is empty on purpose: features add their endpoints with
 * `baseApi.injectEndpoints(...)` in their own `api/` folder, so this file never grows into
 * a list of every endpoint in the app.
 *
 * RTK Query is for online server state (dashboards, admin lists). Offline-critical data
 * (a worker's jobs) will come from SQLite, filled by the sync engine (Versions 5-6).
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: createBaseQuery(() => {
    const config = getConfig();
    return { baseUrl: config.apiBaseUrl, timeoutMs: config.apiTimeoutMs };
  }, resolveAuth),
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
