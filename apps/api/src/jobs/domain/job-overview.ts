import {
  OPEN_STATUSES as SHARED_OPEN_STATUSES,
  UNDER_WAY_STATUSES,
} from '@fieldops/shared';

import { JobStatus } from '../job-enums.js';

/**
 * The manager dashboard's figures, from the counts the repository reads. Pure, so the
 * shaping rules (every status present, workload order and cap) are unit-tested without a
 * database.
 */

/** Statuses that still need work (every non-terminal status). */
export const OPEN_STATUSES: readonly JobStatus[] = SHARED_OPEN_STATUSES;

/** A worker has it but has not set off yet. */
export const WAITING_STATUSES: readonly JobStatus[] = [
  JobStatus.ASSIGNED,
  JobStatus.ACCEPTED,
];

/** A worker is on it right now (en route, arrived, in progress). */
export const BUSY_STATUSES: readonly JobStatus[] = UNDER_WAY_STATUSES;

/** "Due soon" window and the window for recently closed jobs (rolling, no time zone). */
export const DUE_SOON_MS = 24 * 3_600_000;
export const RECENT_CLOSED_MS = 7 * 86_400_000;

/** Caps on the dashboard's lists. */
export const WORKLOAD_LIMIT = 10;
export const ACTIVITY_LIMIT = 10;

interface Person {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface OverviewCounts {
  readonly byStatus: readonly { status: JobStatus; count: number }[];
  /** Open jobs per assignee and status (waiting and busy statuses only). */
  readonly byWorker: readonly {
    workerId: string;
    status: JobStatus;
    count: number;
  }[];
  /** The workers named in `byWorker`. */
  readonly workers: readonly Person[];
}

export interface WorkloadEntry {
  readonly worker: Person;
  readonly assigned: number;
  readonly inProgress: number;
}

/** Every status with its count (0 when there is no job in it). */
export function statusCounts(
  byStatus: OverviewCounts['byStatus'],
): Record<JobStatus, number> {
  const counts = Object.fromEntries(
    Object.values(JobStatus).map(status => [status, 0]),
  ) as Record<JobStatus, number>;
  for (const { status, count } of byStatus) {
    counts[status] += count;
  }
  return counts;
}

/** Workers with open jobs, busiest first (then by name, so the order is stable). */
export function workload(
  byWorker: OverviewCounts['byWorker'],
  workers: OverviewCounts['workers'],
  limit: number = WORKLOAD_LIMIT,
): WorkloadEntry[] {
  const people = new Map(workers.map(worker => [worker.id, worker]));
  const entries = new Map<string, WorkloadEntry>();
  for (const { workerId, status, count } of byWorker) {
    const worker = people.get(workerId);
    if (worker === undefined) {
      continue;
    }
    const entry = entries.get(workerId) ?? {
      worker,
      assigned: 0,
      inProgress: 0,
    };
    entries.set(workerId, {
      ...entry,
      assigned:
        entry.assigned + (WAITING_STATUSES.includes(status) ? count : 0),
      inProgress:
        entry.inProgress + (BUSY_STATUSES.includes(status) ? count : 0),
    });
  }
  const name = (person: Person) => `${person.firstName} ${person.lastName}`;
  return [...entries.values()]
    .sort(
      (a, b) =>
        b.assigned + b.inProgress - (a.assigned + a.inProgress) ||
        name(a.worker).localeCompare(name(b.worker)),
    )
    .slice(0, limit);
}
