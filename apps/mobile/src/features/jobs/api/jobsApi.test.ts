/**
 * @jest-environment node
 */
import { Role, type AuthResult, type JobDetail } from '@fieldops/types';

import { createCredentialStore } from '../../../services/auth/credentialStore';
import type { SecureValueStore } from '../../../services/storage/secureStorage';
import { createAppStore } from '../../../store';
import { toAppError } from '../../../utils/errors';
import { jobsApi } from './jobsApi';

const worker = { id: 'w1', firstName: 'Asha', lastName: 'Verma' };

const session: AuthResult = {
  user: {
    ...worker,
    email: 'asha@example.com',
    role: Role.WORKER,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  tokens: {
    tokenType: 'Bearer',
    accessToken: 'access-1',
    accessTokenExpiresAt: '2099-01-01T00:15:00.000Z',
    refreshToken: 'refresh-1',
    refreshTokenExpiresAt: '2099-01-31T00:00:00.000Z',
  },
};

const job = (overrides: Partial<JobDetail> = {}): JobDetail => ({
  id: 'job-1',
  title: 'AC repair',
  customerName: 'ABC Ltd',
  address: '12 MG Road',
  scheduledAt: '2026-09-27T05:00:00.000Z',
  priority: 'NORMAL',
  status: 'ASSIGNED',
  assignedWorker: worker,
  version: 2,
  updatedAt: '2026-09-26T10:00:00.000Z',
  allowedActions: ['start'],
  description: null,
  location: null,
  notes: null,
  checklist: [],
  cancellationReason: null,
  createdBy: { id: 'm1', firstName: 'Ravi', lastName: 'Kumar' },
  createdAt: '2026-09-26T09:00:00.000Z',
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  history: [],
  ...overrides,
});

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const failure = (status: number, code: string) =>
  new Response(
    JSON.stringify({ success: false, error: { code, message: 'server text' } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

type Route = (request: Request) => Response;

async function setup(routes: Record<string, Route>) {
  const requests: Request[] = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    requests.push(request.clone());
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname}`];
    return route === undefined ? failure(404, 'NOT_FOUND') : route(request);
  }) as unknown as typeof fetch;

  let stored: string | null = null;
  const storage: SecureValueStore = {
    get: async () => stored,
    set: async value => {
      stored = value;
    },
    clear: async () => {
      stored = null;
    },
  };
  const credentials = createCredentialStore(storage);
  await credentials.save(session);
  const store = createAppStore({ services: { credentials } });
  return { store, requests };
}

const originalFetch = globalThis.fetch;
let warnSpy: jest.SpyInstance;

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

/**
 * The store's RootState is typed from baseApi, which does not know the tag types this
 * feature adds with enhanceEndpoints; the cache slice itself is the same object.
 */
type JobsState = Parameters<
  ReturnType<typeof jobsApi.endpoints.getJob.select>
>[0];
const cachedJob = (store: Awaited<ReturnType<typeof setup>>['store']) =>
  jobsApi.endpoints.getJob.select('job-1')(
    store.getState() as unknown as JobsState,
  ).data;

const ACTIVE = {
  statuses: ['ASSIGNED', 'IN_PROGRESS'],
  order: 'asc',
  limit: 2,
} as const;

describe('job list', () => {
  it('requests the filtered list with the access token and pages with the cursor', async () => {
    const { store, requests } = await setup({
      'GET /api/v1/jobs': request =>
        new URL(request.url).searchParams.has('cursor')
          ? ok({ items: [job({ id: 'job-3' })], nextCursor: null })
          : ok({
              items: [job({ id: 'job-1' }), job({ id: 'job-2' })],
              nextCursor: 'cursor-1',
            }),
    });

    const first = await store.dispatch(
      jobsApi.endpoints.listJobs.initiate(ACTIVE),
    );
    expect(first.data?.pages[0]?.items.map(item => item.id)).toEqual([
      'job-1',
      'job-2',
    ]);

    const params = new URL(requests[0]!.url).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      status: 'ASSIGNED,IN_PROGRESS',
      order: 'asc',
      limit: '2',
    });
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer access-1');

    const next = await store.dispatch(
      jobsApi.endpoints.listJobs.initiate(ACTIVE, { direction: 'forward' }),
    );
    expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe(
      'cursor-1',
    );
    expect(
      next.data?.pages.flatMap(page => page.items.map(item => item.id)),
    ).toEqual(['job-1', 'job-2', 'job-3']);
    expect(next.hasNextPage).toBe(false);
  });

  it('refuses a malformed response instead of showing it', async () => {
    const { store } = await setup({
      'GET /api/v1/jobs': () =>
        ok({ items: [{ id: 'job-1', status: 'DONE' }], nextCursor: null }),
    });

    const result = await store.dispatch(
      jobsApi.endpoints.listJobs.initiate(ACTIVE),
    );

    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});

describe('job commands', () => {
  it('starts a job and refetches its details and the lists', async () => {
    let status: JobDetail['status'] = 'ASSIGNED';
    const { store, requests } = await setup({
      'GET /api/v1/jobs/job-1': () => ok(job({ status })),
      'POST /api/v1/jobs/job-1/start': () => {
        status = 'IN_PROGRESS';
        return ok(job({ status, allowedActions: ['complete'] }));
      },
    });
    const details = store.dispatch(jobsApi.endpoints.getJob.initiate('job-1'));
    await details;

    const result = await store.dispatch(
      jobsApi.endpoints.startJob.initiate('job-1'),
    );

    expect(result.data?.status).toBe('IN_PROGRESS');
    expect(
      requests.map(r => `${r.method} ${new URL(r.url).pathname}`),
    ).toContain('POST /api/v1/jobs/job-1/start');
    await jest.runOnlyPendingTimersAsync();
    expect(cachedJob(store)?.status).toBe('IN_PROGRESS');
    details.unsubscribe();
  });

  it('turns a rejected transition into app copy, and still refreshes the stale job', async () => {
    let gets = 0;
    const { store } = await setup({
      'GET /api/v1/jobs/job-1': () => {
        gets += 1;
        return ok(job({ status: gets === 1 ? 'ASSIGNED' : 'CANCELLED' }));
      },
      'POST /api/v1/jobs/job-1/start': () =>
        failure(409, 'INVALID_STATUS_TRANSITION'),
    });
    const details = store.dispatch(jobsApi.endpoints.getJob.initiate('job-1'));
    await details;

    const result = await store.dispatch(
      jobsApi.endpoints.startJob.initiate('job-1'),
    );

    expect(toAppError(result.error)).toMatchObject({
      status: 409,
      code: 'INVALID_STATUS_TRANSITION',
      message:
        "That action isn't possible for this job anymore. The job has been refreshed.",
    });
    await jest.runOnlyPendingTimersAsync();
    expect(gets).toBe(2);
    expect(cachedJob(store)?.status).toBe('CANCELLED');
    details.unsubscribe();
  });

  it('assigns a worker with the worker ID in the body', async () => {
    const { store, requests } = await setup({
      'POST /api/v1/jobs/job-1/assign': () => ok(job()),
    });

    await store.dispatch(
      jobsApi.endpoints.assignJob.initiate({ id: 'job-1', workerId: 'w1' }),
    );

    expect(await requests[0]?.json()).toEqual({ workerId: 'w1' });
  });
});
