import type {
  AssignJobRequest,
  CancelJobRequest,
  CreateJobRequest,
  JobDetail,
  JobPage,
  JobStatus,
  UpdateJobRequest,
  WorkerSummary,
} from '@fieldops/types';

import type { FetchArgs } from '@reduxjs/toolkit/query/react';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { parseError, type AppError } from '../../../utils/errors';
import { isJobDetail, isJobPage, isWorkerList } from './contracts';

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

/**
 * Job endpoints (online, Phase 2). Screens use only the hooks exported here, so the offline
 * phase can move the worker's jobs to SQLite behind the same feature API without touching
 * the screens.
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
        build.mutation<JobDetail, string>({
          queryFn: (id, _api, _extra, send) =>
            fetchChecked(
              send,
              { url: `${API_V1}/jobs/${id}/${path}`, method: 'POST' },
              isJobDetail,
              `job ${path}`,
            ),
          invalidatesTags: (_result, _error, id) => [jobTag(id), LIST],
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
  useCreateJobMutation,
  useUpdateJobMutation,
  useDeleteJobMutation,
  useAssignJobMutation,
  useStartJobMutation,
  useCompleteJobMutation,
  useCancelJobMutation,
  useListWorkersQuery,
} = jobsApi;
