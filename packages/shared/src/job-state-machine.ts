import type { JobStatus, JobType } from '@fieldops/types';

/**
 * The operation lifecycle: the single place that decides which status changes exist. Pure
 * TypeScript with no runtime dependencies, used by the API (to enforce transitions) and by
 * the mobile app (to validate worker commands offline).
 *
 * Every operation type follows one of two lifecycles. Adding a type means choosing its
 * lifecycle in LIFECYCLE_OF below; adding a lifecycle means adding a table.
 *
 * FIELD (DELIVERY, PAYMENT_COLLECTION, SHOP_VISIT, ORDER_COLLECTION, INVENTORY_CHECK):
 *
 *   PENDING ─assign─▶ ASSIGNED ─accept─▶ ACCEPTED ─depart─▶ EN_ROUTE ─arrive─▶ ARRIVED
 *      ▲                 │ decline          │ decline                          │ start
 *      └─────────────────┴──────────────────┘                                  ▼
 *   COMPLETED ◀─verify─ SUBMITTED ◀─submit─ IN_PROGRESS ◀──────────────────────┘
 *                          └───reject (rework)───▶ IN_PROGRESS
 *
 * BASIC (GENERAL, the Phase 2 job, kept exactly as it was):
 *
 *   PENDING ─assign─▶ ASSIGNED ─start─▶ IN_PROGRESS ─complete─▶ COMPLETED
 *
 * Business rules behind the tables:
 * - A worker must accept an assignment before working on it, and may hand it back (decline)
 *   until they set off. Once en route, stopping is a failure with a reason, never a silent
 *   return to the pool.
 * - The steps are strictly ordered: no skipping from ACCEPTED to IN_PROGRESS. Travel and
 *   arrival are what make an operation's history (and its locations) meaningful.
 * - A submitted result is only a claim. It becomes COMPLETED when a manager verifies it
 *   (payments, deliveries and orders take effect only then), or goes back to IN_PROGRESS
 *   when rejected, so the worker can correct it.
 * - Reassignment is possible until the worker sets off. It moves the operation to ASSIGNED:
 *   the new worker has to accept it.
 * - Rescheduling is possible until the worker sets off. An accepted operation goes back to
 *   ASSIGNED, so the worker confirms the new time.
 * - Cancellation is possible at any open status before SUBMITTED. A submitted result must be
 *   verified or rejected first, so money a worker reported collecting is never dropped
 *   without a decision.
 * - COMPLETED, CANCELLED and FAILED are terminal. Reopening would falsify the history; new
 *   work is a new operation.
 */

export type JobTransition =
  | 'assign'
  | 'accept'
  | 'decline'
  | 'depart'
  | 'arrive'
  | 'start'
  | 'complete'
  | 'submit'
  | 'verify'
  | 'reject'
  | 'fail'
  | 'cancel'
  | 'reschedule';

export type Lifecycle = 'basic' | 'field';

type TransitionTable = Readonly<
  Record<JobStatus, Readonly<Partial<Record<JobTransition, JobStatus>>>>
>;

const BASIC: TransitionTable = {
  PENDING: { assign: 'ASSIGNED', cancel: 'CANCELLED', reschedule: 'PENDING' },
  ASSIGNED: {
    assign: 'ASSIGNED',
    start: 'IN_PROGRESS',
    cancel: 'CANCELLED',
    reschedule: 'ASSIGNED',
  },
  IN_PROGRESS: { complete: 'COMPLETED', cancel: 'CANCELLED' },
  // Statuses of the field lifecycle never occur on a basic job.
  ACCEPTED: {},
  EN_ROUTE: {},
  ARRIVED: {},
  SUBMITTED: {},
  COMPLETED: {},
  CANCELLED: {},
  FAILED: {},
};

const FIELD: TransitionTable = {
  PENDING: { assign: 'ASSIGNED', cancel: 'CANCELLED', reschedule: 'PENDING' },
  ASSIGNED: {
    assign: 'ASSIGNED',
    accept: 'ACCEPTED',
    decline: 'PENDING',
    cancel: 'CANCELLED',
    reschedule: 'ASSIGNED',
  },
  ACCEPTED: {
    assign: 'ASSIGNED',
    depart: 'EN_ROUTE',
    decline: 'PENDING',
    fail: 'FAILED',
    cancel: 'CANCELLED',
    reschedule: 'ASSIGNED',
  },
  EN_ROUTE: { arrive: 'ARRIVED', fail: 'FAILED', cancel: 'CANCELLED' },
  ARRIVED: { start: 'IN_PROGRESS', fail: 'FAILED', cancel: 'CANCELLED' },
  IN_PROGRESS: { submit: 'SUBMITTED', fail: 'FAILED', cancel: 'CANCELLED' },
  SUBMITTED: { verify: 'COMPLETED', reject: 'IN_PROGRESS' },
  COMPLETED: {},
  CANCELLED: {},
  FAILED: {},
};

const TABLES: Readonly<Record<Lifecycle, TransitionTable>> = {
  basic: BASIC,
  field: FIELD,
};

const LIFECYCLE_OF: Readonly<Record<JobType, Lifecycle>> = {
  GENERAL: 'basic',
  DELIVERY: 'field',
  PAYMENT_COLLECTION: 'field',
  SHOP_VISIT: 'field',
  ORDER_COLLECTION: 'field',
  INVENTORY_CHECK: 'field',
};

export function lifecycleOf(type: JobType): Lifecycle {
  return LIFECYCLE_OF[type];
}

/** The status a transition leads to from `from`, or undefined when it is not allowed. */
export function nextStatus(
  type: JobType,
  from: JobStatus,
  transition: JobTransition,
): JobStatus | undefined {
  return TABLES[LIFECYCLE_OF[type]][from][transition];
}

export function isTerminal(status: JobStatus): boolean {
  return (
    status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED'
  );
}

/** Open statuses in lifecycle order (everything that is not terminal). */
export const OPEN_STATUSES: readonly JobStatus[] = [
  'PENDING',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
];

/** The worker is on their way or at work: they are "busy" (dashboard). */
export const UNDER_WAY_STATUSES: readonly JobStatus[] = [
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
];

/** Manager-owned fields (title, instructions, priority...) can change until it is closed. */
export function isEditable(status: JobStatus): boolean {
  return !isTerminal(status) && status !== 'SUBMITTED';
}

/** The checklist is fixed once the worker could have started working through it. */
export function isChecklistEditable(status: JobStatus): boolean {
  return status === 'PENDING' || status === 'ASSIGNED';
}

/**
 * Only an unassigned job can be deleted, and the server also requires that it was never
 * assigned (a declined job returns to PENDING but keeps its history). Anything else is
 * cancelled instead.
 */
export function isDeletable(status: JobStatus): boolean {
  return status === 'PENDING';
}

/**
 * The status each transition aims for, for the transitions that are safe to repeat: a
 * repeated command whose target the job has already reached is a retry, not an error.
 * Decline, reject and reschedule are left out: repeating them is never "the same thing
 * again" (a rejected job being IN_PROGRESS does not mean this rejection happened).
 */
const TARGET: Readonly<Partial<Record<JobTransition, JobStatus>>> = {
  assign: 'ASSIGNED',
  accept: 'ACCEPTED',
  depart: 'EN_ROUTE',
  arrive: 'ARRIVED',
  start: 'IN_PROGRESS',
  complete: 'COMPLETED',
  submit: 'SUBMITTED',
  verify: 'COMPLETED',
  fail: 'FAILED',
  cancel: 'CANCELLED',
};

export type TransitionDecision =
  | { readonly kind: 'apply'; readonly to: JobStatus }
  /** The job is already where the command wants it: a retry. Succeed without changes. */
  | { readonly kind: 'alreadyApplied' }
  | { readonly kind: 'rejected' };

/**
 * Decides what a command does to a job of `type` in `status`.
 *
 * Repeatable commands are idempotent with respect to their target: repeating "accept" on a
 * job that is already ACCEPTED (a double tap, or a retry after a lost response) succeeds
 * without a second change instead of failing. A command that would move the job anywhere
 * else is rejected. For `assign`, "already applied" means the job is ASSIGNED to the same
 * worker; a different worker is a reassignment.
 */
export function decideTransition(
  type: JobType,
  status: JobStatus,
  transition: JobTransition,
  options: { readonly sameAssignee?: boolean } = {},
): TransitionDecision {
  const target = TARGET[transition];
  const alreadyThere =
    target !== undefined &&
    status === target &&
    (transition !== 'assign' || options.sameAssignee === true);
  if (alreadyThere) {
    return { kind: 'alreadyApplied' };
  }
  const to = nextStatus(type, status, transition);
  return to === undefined ? { kind: 'rejected' } : { kind: 'apply', to };
}
