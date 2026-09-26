import type { JobStatus } from '@fieldops/types';

/**
 * The job lifecycle: the single place that decides which status changes exist. Pure
 * TypeScript with no runtime dependencies, used by the API (to enforce transitions) and by the
 * mobile app (to validate worker commands offline, Phase 3).
 *
 *   PENDING ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
 *      │                  │  ▲                  │
 *      │                  └──┘ reassign         │
 *      └──────cancel──────┴────────cancel───────┴──▶ CANCELLED
 *
 * Business rules behind the table:
 * - Only an unstarted job can be (re)assigned. Once a worker has started, the job stays with
 *   them; the manager can cancel it if the work must stop.
 * - A manager may cancel at any point before completion (the customer cancelled, the visit is
 *   no longer needed), including while the job is in progress.
 * - COMPLETED and CANCELLED are terminal. Reopening is not supported: there is no business
 *   case for it yet, and it would falsify the job's history. New work is a new job.
 */

export type JobTransition = 'assign' | 'start' | 'complete' | 'cancel';

const TRANSITIONS: Readonly<
  Record<JobStatus, Readonly<Partial<Record<JobTransition, JobStatus>>>>
> = {
  PENDING: {
    assign: 'ASSIGNED',
    cancel: 'CANCELLED',
  },
  ASSIGNED: {
    assign: 'ASSIGNED',
    start: 'IN_PROGRESS',
    cancel: 'CANCELLED',
  },
  IN_PROGRESS: {
    complete: 'COMPLETED',
    cancel: 'CANCELLED',
  },
  COMPLETED: {},
  CANCELLED: {},
};

/** The status a transition leads to from `from`, or undefined when it is not allowed. */
export function nextStatus(
  from: JobStatus,
  transition: JobTransition,
): JobStatus | undefined {
  return TRANSITIONS[from][transition];
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/** Manager-owned fields (title, schedule, notes...) can change until the job is closed. */
export function isEditable(status: JobStatus): boolean {
  return !isTerminal(status);
}

/** The checklist is fixed once the worker starts working through it. */
export function isChecklistEditable(status: JobStatus): boolean {
  return status === 'PENDING' || status === 'ASSIGNED';
}

/**
 * Only a never-assigned job can be deleted (it was created by mistake and no worker has seen
 * it). Anything else is cancelled instead, so its history is kept.
 */
export function isDeletable(status: JobStatus): boolean {
  return status === 'PENDING';
}

/** The status each transition aims for (used to recognize repeated commands). */
const TARGET: Readonly<Record<JobTransition, JobStatus>> = {
  assign: 'ASSIGNED',
  start: 'IN_PROGRESS',
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
};

export type TransitionDecision =
  | { readonly kind: 'apply'; readonly to: JobStatus }
  /** The job is already where the command wants it: a retry. Succeed without changes. */
  | { readonly kind: 'alreadyApplied' }
  | { readonly kind: 'rejected' };

/**
 * Decides what a command does to a job in `status`.
 *
 * Commands are idempotent with respect to their target: repeating "start" on a job that is
 * already IN_PROGRESS (a double tap, or a retry after a lost response) succeeds without a
 * second change instead of failing. A command that would move the job anywhere else is
 * rejected. For `assign`, "already applied" means the job is ASSIGNED to the same worker;
 * a different worker is a reassignment.
 */
export function decideTransition(
  status: JobStatus,
  transition: JobTransition,
  options: { readonly sameAssignee?: boolean } = {},
): TransitionDecision {
  const alreadyThere =
    status === TARGET[transition] &&
    (transition !== 'assign' || options.sameAssignee === true);
  if (alreadyThere) {
    return { kind: 'alreadyApplied' };
  }
  const to = nextStatus(status, transition);
  return to === undefined ? { kind: 'rejected' } : { kind: 'apply', to };
}
