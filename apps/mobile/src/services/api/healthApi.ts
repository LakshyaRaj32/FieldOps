import { baseApi } from './baseApi';

export interface LivenessResult {
  /** ISO timestamp of when the API answered. */
  readonly checkedAt: string;
}

/**
 * API liveness check, used by the diagnostics panel to verify environment configuration and
 * reachability from the device. The `/health/live` endpoint is part of the Version 3 backend;
 * until then this reports the API as unreachable, which is the correct result.
 */
export const healthApi = baseApi.injectEndpoints({
  endpoints: build => ({
    checkLiveness: build.query<LivenessResult, void>({
      query: () => '/health/live',
      transformResponse: () => ({ checkedAt: new Date().toISOString() }),
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useLazyCheckLivenessQuery } = healthApi;
