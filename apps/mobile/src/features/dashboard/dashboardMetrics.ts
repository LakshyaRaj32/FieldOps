import { JobStatus, type JobOverview } from '@fieldops/types';

import type { ChartColors } from '../../theme';

/**
 * Figures the dashboard derives from real data: the server's overview for managers, the
 * phone's own jobs for workers. Pure, so every number on the dashboard is unit-tested. When
 * a figure cannot be computed (nothing closed yet), it is `null` and shown as "–", never 0%.
 */

type StatusCounts = JobOverview['statusCounts'];

export function openJobs(counts: StatusCounts): number {
  return counts.PENDING + counts.ASSIGNED + counts.IN_PROGRESS;
}

export function totalJobs(counts: StatusCounts): number {
  return Object.values(JobStatus).reduce(
    (sum, status) => sum + counts[status],
    0,
  );
}

/** The share of closed jobs that were completed rather than cancelled (0–1), or null. */
export function completionRate(
  completed: number,
  cancelled: number,
): number | null {
  const closed = completed + cancelled;
  return closed === 0 ? null : completed / closed;
}

/** "92%", or "–" when there is nothing to compute from. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

/** Order of the status breakdown: the job's life from left to right. */
export const STATUS_ORDER: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.COMPLETED,
  JobStatus.CANCELLED,
];

export const STATUS_CHART_KEYS: Readonly<Record<JobStatus, keyof ChartColors>> =
  {
    PENDING: 'pending',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'inProgress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };

export interface StatusSegment {
  readonly status: JobStatus;
  readonly count: number;
  /** 0–1 of all jobs. */
  readonly share: number;
}

/** One segment per status, in life-cycle order (zero-count statuses have share 0). */
export function statusSegments(counts: StatusCounts): StatusSegment[] {
  const total = totalJobs(counts);
  return STATUS_ORDER.map(status => ({
    status,
    count: counts[status],
    share: total === 0 ? 0 : counts[status] / total,
  }));
}

/** A worker's own figures, from the jobs on their phone (works offline). */
export interface WorkerFigures {
  readonly open: number;
  readonly inProgress: number;
  /** Completed jobs still on the phone (the working set keeps the last 7 days). */
  readonly completedRecently: number;
}

export function workerFigures(
  active: readonly { readonly job: { readonly status: JobStatus } }[],
  closed: readonly { readonly job: { readonly status: JobStatus } }[],
): WorkerFigures {
  return {
    open: active.length,
    inProgress: active.filter(item => item.job.status === JobStatus.IN_PROGRESS)
      .length,
    completedRecently: closed.filter(
      item => item.job.status === JobStatus.COMPLETED,
    ).length,
  };
}
