import type {
  AddJobNoteRequest,
  AssignJobRequest,
  CancelJobRequest,
  CreateJobRequest,
  EvidenceContentType,
  JobCommandRequest,
  JobDetail,
  JobOverview,
  JobPage,
  JobStatus,
  JobWorkingSet,
  SendJobMessageRequest,
  UpdateJobRequest,
  WorkerSummary,
} from '@fieldops/types';

import type { FetchArgs } from '@reduxjs/toolkit/query/react';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { parseError, type AppError } from '../../../utils/errors';
import {
  isJobDetail,
  isJobOverview,
  isJobPage,
  isJobWorkingSet,
  isWorkerList,
} from './contracts';

/** Filters for a job list. Workers always get their own jobs (enforced by the server). */
export interface JobListArgs {
  readonly statuses: readonly JobStatus[];
  /** By scheduled time: `asc` = next first, `desc` = latest first. */
  readonly order: 'asc' | 'desc';
  readonly limit?: number;
}

const LIST = { type: 'Job', id: 'LIST' } as const;
const jobTag = (id: string) => ({ type: 'Job', id } as const);

type SendResult = {
  readonly data?: unknown;
  readonly error?: AppError | undefined;
};
/** The `baseQuery` RTK Query hands to `queryFn` (it may answer synchronously). */
type SendRequest = (
  args: string | FetchArgs,
) => SendResult | PromiseLike<SendResult>;

/**
 * Sends a request and checks the response body before it enters the cache. A body of the
 * wrong shape becomes a `parse` AppError: an ordinary failed request, so screens show their
 * error state and tags are still invalidated (throwing would skip both).
 */
async function fetchChecked<T>(
  send: SendRequest,
  args: string | FetchArgs,
  guard: (value: unknown) => value is T,
  what: string,
): Promise<{ data: T } | { error: AppError }> {
  const result = await send(args);
  if (result.error !== undefined) {
    return { error: result.error };
  }
  return guard(result.data)
    ? { data: result.data }
    : { error: parseError(`Unexpected ${what} response`) };
}

/** A worker command as the sync engine sends it: the same key on every attempt. */
export interface WorkerCommandArgs {
  readonly id: string;
  readonly idempotencyKey: string;
}

/** A photo upload as the sync engine sends it (the file stays on disk until then). */
export interface EvidenceUploadArgs extends WorkerCommandArgs {
  readonly evidenceId: string;
  readonly fileUri: string;
  readonly contentType: EvidenceContentType;
  readonly capturedAt: string;
}

const IDEMPOTENCY_KEY = 'Idempotency-Key';

/** Uploads get far longer than ordinary requests: a photo over 2G takes a while. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Where a photo's bytes are served (an authenticated GET; see EvidenceImage). */
export const evidenceContentPath = (jobId: string, evidenceId: string) =>
  `${API_V1}/jobs/${jobId}/evidence/${evidenceId}/content`;

/**
 * Job endpoints. Managers use them directly (online screens). Workers never call the command
 * or read endpoints from screens: their jobs live in SQLite and reach the server through the
 * sync engine (data/apiTransport.ts), which uses `startJob`, `completeJob`, `addJobNote` and
 * `getWorkingSet` here, so authentication, token refresh and error mapping stay in one place.
 *
 * Every command invalidates the job and the lists, also when it fails: a VERSION_CONFLICT or
 * INVALID_STATUS_TRANSITION means the screen is showing a stale job, and the refetch brings
 * it up to date.
 */
export const jobsApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Job', 'Worker'] })
  .injectEndpoints({
    endpoints: build => {
      const command = (path: 'start' | 'complete') =>
        build.mutation<
          JobDetail,
          WorkerCommandArgs & { readonly request?: JobCommandRequest }
        >({
          queryFn: ({ id, idempotencyKey, request = {} }, _api, _extra, send) =>
            fetchChecked(
              send,
              {
                url: `${API_V1}/jobs/${id}/${path}`,
                method: 'POST',
                headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
                body: request,
              },
              isJobDetail,
              `job ${path}`,
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        });

      return {
        listJobs: build.infiniteQuery<JobPage, JobListArgs, string | null>({
          infiniteQueryOptions: {
            initialPageParam: null,
            getNextPageParam: lastPage => lastPage.nextCursor,
          },
          queryFn: ({ queryArg, pageParam }, _api, _extra, send) =>
            fetchChecked(
              send,
              {
                url: `${API_V1}/jobs`,
                params: {
                  status: queryArg.statuses.join(','),
                  order: queryArg.order,
                  limit: queryArg.limit ?? 20,
                  ...(pageParam !== null && { cursor: pageParam }),
                },
              },
              isJobPage,
              'job list',
            ),
          providesTags: [LIST],
        }),

        /**
         * The manager dashboard's figures. Tagged like the lists, so everything that
         * refreshes the job lists (job commands, realtime events) refreshes it too.
         */
        getJobOverview: build.query<JobOverview, void>({
          queryFn: (_arg, _api, _extra, send) =>
            fetchChecked(
              send,
              `${API_V1}/jobs/overview`,
              isJobOverview,
              'job overview',
            ),
          providesTags: [LIST],
        }),

        getJob: build.query<JobDetail, string>({
          queryFn: (id, _api, _extra, send) =>
            fetchChecked(send, `${API_V1}/jobs/${id}`, isJobDetail, 'job'),
          providesTags: (_result, _error, id) => [jobTag(id)],
        }),

        createJob: build.mutation<JobDetail, CreateJobRequest>({
          queryFn: (body, _api, _extra, send) =>
            fetchChecked(
              send,
              { url: `${API_V1}/jobs`, method: 'POST', body },
              isJobDetail,
              'job create',
            ),
          invalidatesTags: [LIST],
        }),

        updateJob: build.mutation<
          JobDetail,
          { readonly id: string; readonly changes: UpdateJobRequest }
        >({
          queryFn: ({ id, changes }, _api, _extra, send) =>
            fetchChecked(
              send,
              { url: `${API_V1}/jobs/${id}`, method: 'PATCH', body: changes },
              isJobDetail,
              'job update',
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        deleteJob: build.mutation<null, string>({
          query: id => ({ url: `${API_V1}/jobs/${id}`, method: 'DELETE' }),
          invalidatesTags: [LIST],
        }),

        assignJob: build.mutation<
          JobDetail,
          { readonly id: string } & AssignJobRequest
        >({
          queryFn: ({ id, workerId }, _api, _extra, send) =>
            fetchChecked(
              send,
              {
                url: `${API_V1}/jobs/${id}/assign`,
                method: 'POST',
                body: { workerId },
              },
              isJobDetail,
              'job assign',
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        startJob: command('start'),
        completeJob: command('complete'),

        addJobNote: build.mutation<
          JobDetail,
          WorkerCommandArgs & { readonly note: AddJobNoteRequest }
        >({
          queryFn: ({ id, idempotencyKey, note }, _api, _extra, send) =>
            fetchChecked(
              send,
              {
                url: `${API_V1}/jobs/${id}/notes`,
                method: 'POST',
                headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
                body: note,
              },
              isJobDetail,
              'job note',
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        uploadJobEvidence: build.mutation<JobDetail, EvidenceUploadArgs>({
          queryFn: (
            {
              id,
              idempotencyKey,
              evidenceId,
              fileUri,
              contentType,
              capturedAt,
            },
            _api,
            _extra,
            send,
          ) => {
            const form = new FormData();
            form.append('id', evidenceId);
            form.append('capturedAt', capturedAt);
            // React Native's FormData streams the file from its URI.
            form.append('file', {
              uri: fileUri,
              name: `${evidenceId}.${
                contentType === 'image/png' ? 'png' : 'jpg'
              }`,
              type: contentType,
            } as unknown as Blob);
            return fetchChecked(
              send,
              {
                url: `${API_V1}/jobs/${id}/evidence`,
                method: 'POST',
                headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
                body: form,
                timeout: UPLOAD_TIMEOUT_MS,
              },
              isJobDetail,
              'evidence upload',
            );
          },
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        /**
         * A message on a job. The sync engine sends workers' messages with a stable key;
         * managers send theirs online (`idempotencyKey` = the message ID, so a double tap is
         * one message).
         */
        sendJobMessage: build.mutation<
          JobDetail,
          WorkerCommandArgs & { readonly message: SendJobMessageRequest }
        >({
          queryFn: ({ id, idempotencyKey, message }, _api, _extra, send) =>
            fetchChecked(
              send,
              {
                url: `${API_V1}/jobs/${id}/messages`,
                method: 'POST',
                headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
                body: message,
              },
              isJobDetail,
              'job message',
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        getWorkingSet: build.query<JobWorkingSet, void>({
          queryFn: (_arg, _api, _extra, send) =>
            fetchChecked(
              send,
              `${API_V1}/jobs/working-set`,
              isJobWorkingSet,
              'working set',
            ),
          // The sync engine stores the result in SQLite; nothing reads it from the cache.
          keepUnusedDataFor: 0,
        }),

        cancelJob: build.mutation<
          JobDetail,
          { readonly id: string } & CancelJobRequest
        >({
          queryFn: ({ id, ...body }, _api, _extra, send) =>
            fetchChecked(
              send,
              { url: `${API_V1}/jobs/${id}/cancel`, method: 'POST', body },
              isJobDetail,
              'job cancel',
            ),
          invalidatesTags: (_result, _error, { id }) => [jobTag(id), LIST],
        }),

        listWorkers: build.query<WorkerSummary[], void>({
          queryFn: (_arg, _api, _extra, send) =>
            fetchChecked(
              send,
              `${API_V1}/users/workers`,
              isWorkerList,
              'worker list',
            ),
          providesTags: ['Worker'],
        }),
      };
    },
  });

export const {
  useListJobsInfiniteQuery,
  useGetJobQuery,
  useGetJobOverviewQuery,
  useCreateJobMutation,
  useUpdateJobMutation,
  useDeleteJobMutation,
  useAssignJobMutation,
  useCancelJobMutation,
  useListWorkersQuery,
  useSendJobMessageMutation,
} = jobsApi;
