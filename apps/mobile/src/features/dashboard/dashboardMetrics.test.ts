import { JobStatus } from '@fieldops/types';

import {
  completionRate,
  formatPercent,
  openJobs,
  statusSegments,
  totalJobs,
  underWay,
  waiting,
  workerFigures,
} from './dashboardMetrics';

const counts = {
  PENDING: 2,
  ASSIGNED: 2,
  ACCEPTED: 1,
  EN_ROUTE: 1,
  ARRIVED: 0,
  IN_PROGRESS: 1,
  SUBMITTED: 1,
  COMPLETED: 10,
  CANCELLED: 1,
  FAILED: 1,
};

describe('dashboard metrics', () => {
  it('counts open, waiting, under way and total operations', () => {
    expect(openJobs(counts)).toBe(8);
    expect(waiting(counts)).toBe(3);
    expect(underWay(counts)).toBe(2);
    expect(totalJobs(counts)).toBe(20);
  });

  it('computes the completion rate from closed jobs only, and has none without data', () => {
    expect(completionRate(12, 2)).toBeCloseTo(12 / 14);
    expect(formatPercent(completionRate(12, 2))).toBe('86%');
    expect(completionRate(8, 1, 1)).toBeCloseTo(0.8);
    expect(completionRate(0, 0)).toBeNull();
    expect(formatPercent(null)).toBe('–');
    expect(formatPercent(completionRate(0, 3))).toBe('0%');
  });

  it('groups operations into the six stages, in life-cycle order', () => {
    const segments = statusSegments(counts);
    expect(segments.map(segment => [segment.bucket, segment.count])).toEqual([
      ['unassigned', 2],
      ['waiting', 3],
      ['underWay', 2],
      ['awaitingVerification', 1],
      ['completed', 10],
      ['closedOtherwise', 2],
    ]);
    expect(
      segments.reduce((sum, segment) => sum + segment.share, 0),
    ).toBeCloseTo(1);
    const none = Object.fromEntries(
      Object.values(JobStatus).map(status => [status, 0]),
    ) as typeof counts;
    expect(statusSegments(none).every(segment => segment.share === 0)).toBe(
      true,
    );
  });

  it("derives a worker's figures from the jobs on the phone", () => {
    const item = (status: JobStatus) => ({ job: { status } });
    expect(
      workerFigures(
        [
          item(JobStatus.ASSIGNED),
          item(JobStatus.EN_ROUTE),
          item(JobStatus.IN_PROGRESS),
          item(JobStatus.SUBMITTED),
        ],
        [item(JobStatus.COMPLETED), item(JobStatus.CANCELLED)],
      ),
    ).toEqual({
      open: 4,
      inProgress: 2,
      awaitingVerification: 1,
      completedRecently: 1,
    });
  });
});
