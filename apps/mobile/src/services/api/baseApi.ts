import { createApi } from '@reduxjs/toolkit/query/react';

import { getConfig } from '../../app/config';
import { createBaseQuery } from './baseQuery';

/** Prefix for versioned business endpoints (health checks live outside it). */
export const API_V1 = '/api/v1';

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
  }),
  refetchOnReconnect: true,
  endpoints: () => ({}),
});
