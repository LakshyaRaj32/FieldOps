import { OPEN_STATUSES, UNDER_WAY_STATUSES } from '@fieldops/shared';
import { JobStatus, type JobOverview } from '@fieldops/types';

import type { ChartColors } from '../../theme';

/**
 * Figures the dashboard derives from real data: the server's overview for managers, the
 * phone's own jobs for workers. Pure, so every number on the dashboard is unit-tested. When
 * a figure cannot be computed (nothing closed yet), it is `null` and shown as "–", never 0%.
 */

type StatusCounts = JobOverview['statusCounts'];

const sum = (counts: StatusCounts, statuses: readonly JobStatus[]): number =>
  statuses.reduce((total, status) => total + counts[status], 0);

export function openJobs(counts: StatusCounts): number {
  return sum(counts, OPEN_STATUSES);
}

/** Operations a worker is on right now (en route, at the shop, working). */
export function underWay(counts: StatusCounts): number {
  return sum(counts, UNDER_WAY_STATUSES);
}

/** Assigned or accepted, not under way yet. */
export function waiting(counts: StatusCounts): number {
  return counts.ASSIGNED + counts.ACCEPTED;
}

export function totalJobs(counts: StatusCounts): number {
  return sum(counts, Object.values(JobStatus));
}

/** The share of closed jobs that were completed rather than cancelled or failed (0–1). */
export function completionRate(
  completed: number,
  cancelled: number,
  failed = 0,
): number | null {
  const closed = completed + cancelled + failed;
  return closed === 0 ? null : completed / closed;
}

/** "92%", or "–" when there is nothing to compute from. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

/**
 * The status breakdown groups the ten statuses into the six stages a manager acts on, in
 * life-cycle order, so the bar stays readable.
 */
export type StatusBucket =
  | 'unassigned'
  | 'waiting'
  | 'underWay'
  | 'awaitingVerification'
  | 'completed'
  | 'closedOtherwise';

export const BUCKETS: Readonly<
  Record<
    StatusBucket,
    {
      readonly label: string;
      readonly statuses: readonly JobStatus[];
      readonly chart: keyof ChartColors;
    }
  >
> = {
  unassigned: {
    label: 'Unassigned',
    statuses: [JobStatus.PENDING],
    chart: 'pending',
  },
  waiting: {
    label: 'Assigned',
    statuses: [JobStatus.ASSIGNED, JobStatus.ACCEPTED],
    chart: 'assigned',
  },
  underWay: {
    label: 'Under way',
    statuses: UNDER_WAY_STATUSES,
    chart: 'inProgress',
  },
  awaitingVerification: {
    label: 'To verify',
    statuses: [JobStatus.SUBMITTED],
    chart: 'submitted',
  },
  completed: {
    label: 'Completed',
    statuses: [JobStatus.COMPLETED],
    chart: 'completed',
  },
  closedOtherwise: {
    label: 'Cancelled or failed',
    statuses: [JobStatus.CANCELLED, JobStatus.FAILED],
    chart: 'cancelled',
  },
};

export const BUCKET_ORDER: readonly StatusBucket[] = [
  'unassigned',
  'waiting',
  'underWay',
  'awaitingVerification',
  'completed',
  'closedOtherwise',
];

export interface StatusSegment {
  readonly bucket: StatusBucket;
  readonly count: number;
  /** 0–1 of all jobs. */
  readonly share: number;
}

/** One segment per stage, in life-cycle order (empty stages have share 0). */
export function statusSegments(counts: StatusCounts): StatusSegment[] {
  const total = totalJobs(counts);
  return BUCKET_ORDER.map(bucket => {
    const count = sum(counts, BUCKETS[bucket].statuses);
    return { bucket, count, share: total === 0 ? 0 : count / total };
  });
}

/** A worker's own figures, from the jobs on their phone (works offline). */
export interface WorkerFigures {
  readonly open: number;
  readonly inProgress: number;
  /** Submitted, waiting for the manager. */
  readonly awaitingVerification: number;
  /** Completed jobs still on the phone (the working set keeps the last 7 days). */
  readonly completedRecently: number;
}

export function workerFigures(
  active: readonly { readonly job: { readonly status: JobStatus } }[],
  closed: readonly { readonly job: { readonly status: JobStatus } }[],
): WorkerFigures {
  return {
    open: active.length,
    inProgress: active.filter(item =>
      UNDER_WAY_STATUSES.includes(item.job.status),
    ).length,
    awaitingVerification: active.filter(
      item => item.job.status === JobStatus.SUBMITTED,
    ).length,
    completedRecently: closed.filter(
      item => item.job.status === JobStatus.COMPLETED,
    ).length,
  };
}
