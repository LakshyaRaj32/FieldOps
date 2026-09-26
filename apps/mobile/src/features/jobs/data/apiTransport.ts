import type { AppDispatch } from '../../../store';
import { toAppError } from '../../../utils/errors';
import { jobsApi } from '../api/jobsApi';
import type { JobSyncTransport, TransportResult } from './syncEngine';

/**
 * The sync engine's server calls, through the app's API layer: the same base query as every
 * other request (bearer token, one shared token refresh, request IDs, AppError mapping).
 * Commands are not tracked in the Redux store; their results go to SQLite.
 */
export function createApiTransport(dispatch: AppDispatch): JobSyncTransport {
  const settle = async <Data>(
    request: PromiseLike<{ data?: Data; error?: unknown }>,
  ): Promise<TransportResult<NonNullable<Data>>> => {
    const { data, error } = await request;
    if (error !== undefined || data === undefined || data === null) {
      return { error: toAppError(error) };
    }
    return { data };
  };

  return {
    startJob: (id, idempotencyKey) =>
      settle(
        dispatch(
          jobsApi.endpoints.startJob.initiate(
            { id, idempotencyKey },
            { track: false },
          ),
        ),
      ),
    completeJob: (id, idempotencyKey) =>
      settle(
        dispatch(
          jobsApi.endpoints.completeJob.initiate(
            { id, idempotencyKey },
            { track: false },
          ),
        ),
      ),
    addNote: (id, idempotencyKey, note) =>
      settle(
        dispatch(
          jobsApi.endpoints.addJobNote.initiate(
            { id, idempotencyKey, note },
            { track: false },
          ),
        ),
      ),
    fetchWorkingSet: () =>
      settle(
        dispatch(
          jobsApi.endpoints.getWorkingSet.initiate(undefined, {
            subscribe: false,
            forceRefetch: true,
          }),
        ),
      ),
  };
}
