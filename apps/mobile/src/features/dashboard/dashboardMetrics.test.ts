import { JobStatus } from '@fieldops/types';

import {
  completionRate,
  formatPercent,
  openJobs,
  statusSegments,
  totalJobs,
  workerFigures,
} from './dashboardMetrics';

const counts = {
  PENDING: 2,
  ASSIGNED: 3,
  IN_PROGRESS: 1,
  COMPLETED: 12,
  CANCELLED: 2,
};

describe('dashboard metrics', () => {
  it('counts open and total jobs', () => {
    expect(openJobs(counts)).toBe(6);
    expect(totalJobs(counts)).toBe(20);
  });

  it('computes the completion rate from closed jobs only, and has none without data', () => {
    expect(completionRate(12, 2)).toBeCloseTo(12 / 14);
    expect(formatPercent(completionRate(12, 2))).toBe('86%');
    expect(completionRate(0, 0)).toBeNull();
    expect(formatPercent(null)).toBe('–');
    expect(formatPercent(completionRate(0, 3))).toBe('0%');
  });

  it('splits jobs into status segments in life-cycle order', () => {
    const segments = statusSegments(counts);
    expect(segments.map(segment => segment.status)).toEqual([
      'PENDING',
      'ASSIGNED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ]);
    expect(segments.map(segment => segment.share)).toEqual([
      0.1, 0.15, 0.05, 0.6, 0.1,
    ]);
    const none = {
      PENDING: 0,
      ASSIGNED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
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
          item(JobStatus.IN_PROGRESS),
          item(JobStatus.ASSIGNED),
        ],
        [item(JobStatus.COMPLETED), item(JobStatus.CANCELLED)],
      ),
    ).toEqual({ open: 3, inProgress: 1, completedRecently: 1 });
  });
});
