import type { EvidenceFiles } from '../../../services/files/evidenceFiles';
import type { AppDispatch } from '../../../store';
import { toAppError } from '../../../utils/errors';
import { jobsApi } from '../api/jobsApi';
import { LOCAL_FILE_MISSING } from './retryPolicy';
import type { JobSyncTransport, TransportResult } from './syncEngine';

/**
 * The sync engine's server calls, through the app's API layer: the same base query as every
 * other request (bearer token, one shared token refresh, request IDs, AppError mapping).
 * Commands are not tracked in the Redux store; their results go to SQLite.
 */
export function createApiTransport(
  dispatch: AppDispatch,
  files: Pick<EvidenceFiles, 'exists'>,
): JobSyncTransport {
  const settle = async <Data>(
    request: PromiseLike<{ data?: Data; error?: unknown }>,
  ): Promise<TransportResult<NonNullable<Data>>> => {
    const { data, error } = await request;
    if (error !== undefined || data === undefined || data === null) {
      return { error: toAppError(error) };
    }
    return { data };
  };

  const endpoints = {
    accept: jobsApi.endpoints.acceptJob,
    decline: jobsApi.endpoints.declineJob,
    depart: jobsApi.endpoints.departJob,
    arrive: jobsApi.endpoints.arriveJob,
    start: jobsApi.endpoints.startJob,
    complete: jobsApi.endpoints.completeJob,
    submit: jobsApi.endpoints.submitJob,
    fail: jobsApi.endpoints.failJob,
  } as const;

  return {
    workerCommand: (action, id, idempotencyKey, body) =>
      settle(
        dispatch(
          // Every endpoint takes the same arguments; the body type is the action's.
          (endpoints[action] as typeof jobsApi.endpoints.startJob).initiate(
            { id, idempotencyKey, request: body },
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
    uploadEvidence: async (id, idempotencyKey, evidence) => {
      // A missing file would look like a network failure to fetch and be retried forever.
      const present = await files.exists(evidence.fileUri).catch(() => false);
      if (!present) {
        return {
          error: {
            kind: 'unexpected',
            code: LOCAL_FILE_MISSING,
            message: 'The photo is no longer on this phone.',
          },
        };
      }
      return settle(
        dispatch(
          jobsApi.endpoints.uploadJobEvidence.initiate(
            {
              id,
              idempotencyKey,
              evidenceId: evidence.id,
              fileUri: evidence.fileUri,
              contentType: evidence.contentType,
              capturedAt: evidence.capturedAt,
            },
            { track: false },
          ),
        ),
      );
    },
    sendMessage: (id, idempotencyKey, message) =>
      settle(
        dispatch(
          jobsApi.endpoints.sendJobMessage.initiate(
            { id, idempotencyKey, message },
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
