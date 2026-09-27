import { serverJob, WORKER } from '../../../testing/fakeJobServer';
import { isJobDetail, isJobOverview } from './contracts';

describe('isJobDetail (Phase 4 fields)', () => {
  const evidence = {
    id: 'evidence-1',
    contentType: 'image/jpeg',
    sizeBytes: 100,
    width: 10,
    height: 10,
    uploadedBy: WORKER,
    capturedAt: '2026-09-27T09:00:00.000Z',
    createdAt: '2026-09-27T09:01:00.000Z',
  };
  const location = {
    latitude: 12.97,
    longitude: 77.59,
    accuracyMeters: 9,
    capturedAt: '2026-09-27T09:00:00.000Z',
    distanceMeters: 40,
  };

  it('accepts locations, evidence and messages', () => {
    expect(
      isJobDetail(
        serverJob({
          startLocation: location,
          completeLocation: { ...location, distanceMeters: null },
          evidence: [evidence] as never,
          messages: [
            {
              id: 'm-1',
              body: 'Hi',
              author: WORKER,
              occurredAt: '2026-09-27T09:00:00.000Z',
              createdAt: '2026-09-27T09:00:01.000Z',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('refuses evidence of an unexpected type and malformed locations', () => {
    expect(
      isJobDetail(
        serverJob({
          evidence: [{ ...evidence, contentType: 'text/html' }] as never,
        }),
      ),
    ).toBe(false);
    expect(
      isJobDetail(
        serverJob({
          startLocation: { ...location, latitude: 'north' } as never,
        }),
      ),
    ).toBe(false);
  });

  it('refuses a job without the Phase 4 fields (an older server)', () => {
    const older = Object.fromEntries(
      Object.entries(serverJob()).filter(([key]) => key !== 'evidence'),
    );
    expect(isJobDetail(older)).toBe(false);
  });
});

describe('isJobOverview', () => {
  const overview = {
    statusCounts: {
      PENDING: 1,
      ASSIGNED: 2,
      IN_PROGRESS: 1,
      COMPLETED: 5,
      CANCELLED: 0,
    },
    overdue: 1,
    dueNext24Hours: 2,
    completedLast7Days: 5,
    cancelledLast7Days: 0,
    workload: [{ worker: WORKER, assigned: 2, inProgress: 1 }],
    recentActivity: [
      {
        id: 'event-1',
        jobId: 'job-1',
        jobTitle: 'AC repair',
        type: 'COMPLETED',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        actor: WORKER,
        assignee: null,
        createdAt: '2026-09-27T09:00:00.000Z',
      },
    ],
    generatedAt: '2026-09-27T10:00:00.000Z',
  };

  it('accepts the dashboard figures', () => {
    expect(isJobOverview(overview)).toBe(true);
    expect(
      isJobOverview({ ...overview, workload: [], recentActivity: [] }),
    ).toBe(true);
  });

  it('refuses a missing status count, a non-numeric figure or an activity without its job', () => {
    expect(
      isJobOverview({
        ...overview,
        statusCounts: { ...overview.statusCounts, PENDING: undefined },
      }),
    ).toBe(false);
    expect(isJobOverview({ ...overview, overdue: '1' })).toBe(false);
    expect(
      isJobOverview({
        ...overview,
        recentActivity: [
          { ...overview.recentActivity[0], jobTitle: undefined },
        ],
      }),
    ).toBe(false);
  });
});
