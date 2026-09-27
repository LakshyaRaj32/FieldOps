import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { isOrganizationWide } from '../../common/tenancy/scope.js';
import { Role } from '../../users/role.js';
import { JobAction, type JobStatus, type JobType } from '../job-enums.js';
import {
  isDeletable,
  isEditable,
  nextStatus,
  type JobTransition,
} from '@fieldops/shared';

/**
 * Operation authorization. Pure functions, used for every operation: the controller's route
 * gates (@Roles), the service's resource checks and the `allowedActions` sent to clients
 * all come from here, so there is one source of authorization truth
 * (docs/backend-architecture.md, "Authorization").
 *
 * Three layers (docs/business-domain.md, "Roles and scopes"):
 * 1. Tenancy: an operation is visible only inside its own organization. This is checked
 *    first, for everyone, against the principal's organization (never a client value).
 * 2. Permissions per role (JOB_PERMISSIONS). Code asks for a permission, never a role name.
 * 3. The relationship: workers see and work only what is assigned to them; managers
 *    without organization-wide access see the operations they are responsible for.
 */

export type JobPermission =
  | 'job:create'
  | 'job:read:all'
  | 'job:read:assigned'
  | 'job:edit'
  | 'job:assign'
  | 'job:cancel'
  | 'job:delete'
  | 'job:review'
  | 'job:reschedule'
  | 'job:work'
  | 'job:note'
  | 'job:evidence'
  | 'job:message';

/** The organization's staff: they run operations. SUPER_ADMINs are not staff of anyone. */
const STAFF: readonly Role[] = [Role.MANAGER, Role.ORGANIZATION_ADMIN];
const WORKERS: readonly Role[] = [Role.WORKER];

export const JOB_PERMISSIONS: Readonly<Record<JobPermission, readonly Role[]>> =
  {
    'job:create': STAFF,
    // "all" within the staff member's scope: see canView.
    'job:read:all': STAFF,
    'job:read:assigned': WORKERS,
    'job:edit': STAFF,
    'job:assign': STAFF,
    'job:cancel': STAFF,
    'job:delete': STAFF,
    // Verifying or rejecting a submitted result.
    'job:review': STAFF,
    'job:reschedule': STAFF,
    // Field work (accept, decline, travel, arrive, start, complete, submit, fail): only
    // the assigned worker does it.
    'job:work': WORKERS,
    'job:note': WORKERS,
    'job:evidence': WORKERS,
    // The operation's conversation: its worker and its staff.
    'job:message': [...WORKERS, ...STAFF],
  };

/** The permission each action on an existing job requires. */
export const ACTION_PERMISSION: Readonly<Record<JobAction, JobPermission>> = {
  [JobAction.ACCEPT]: 'job:work',
  [JobAction.DECLINE]: 'job:work',
  [JobAction.DEPART]: 'job:work',
  [JobAction.ARRIVE]: 'job:work',
  [JobAction.START]: 'job:work',
  [JobAction.COMPLETE]: 'job:work',
  [JobAction.SUBMIT]: 'job:work',
  [JobAction.FAIL]: 'job:work',
  [JobAction.VERIFY]: 'job:review',
  [JobAction.REJECT]: 'job:review',
  [JobAction.RESCHEDULE]: 'job:reschedule',
  [JobAction.ASSIGN]: 'job:assign',
  [JobAction.EDIT]: 'job:edit',
  [JobAction.CANCEL]: 'job:cancel',
  [JobAction.DELETE]: 'job:delete',
  [JobAction.NOTE]: 'job:note',
  [JobAction.EVIDENCE]: 'job:evidence',
  [JobAction.MESSAGE]: 'job:message',
};

/** The state-machine transition behind each status action. */
const ACTION_TRANSITION: Readonly<Partial<Record<JobAction, JobTransition>>> = {
  [JobAction.ACCEPT]: 'accept',
  [JobAction.DECLINE]: 'decline',
  [JobAction.DEPART]: 'depart',
  [JobAction.ARRIVE]: 'arrive',
  [JobAction.START]: 'start',
  [JobAction.COMPLETE]: 'complete',
  [JobAction.SUBMIT]: 'submit',
  [JobAction.FAIL]: 'fail',
  [JobAction.VERIFY]: 'verify',
  [JobAction.REJECT]: 'reject',
  [JobAction.RESCHEDULE]: 'reschedule',
  [JobAction.ASSIGN]: 'assign',
  [JobAction.CANCEL]: 'cancel',
};

/** Roles holding a permission: for @Roles() route gates. */
export function rolesWith(permission: JobPermission): Role[] {
  return [...JOB_PERMISSIONS[permission]];
}

export function hasPermission(role: Role, permission: JobPermission): boolean {
  return JOB_PERMISSIONS[permission].includes(role);
}

/** What the policy needs to know about a job. */
export interface JobAccessFacts {
  readonly organizationId: string;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly assignedWorkerId: string | null;
  readonly managerId: string;
}

/**
 * Whether the user may see the job at all. A job the user may not see must be reported as
 * not found (404), so its existence is not revealed (not across organizations, not to
 * workers probing IDs, not to other teams).
 */
export function canView(user: AuthenticatedUser, job: JobAccessFacts): boolean {
  if (
    user.organizationId === null ||
    user.organizationId !== job.organizationId
  ) {
    return false;
  }
  if (hasPermission(user.role, 'job:read:all')) {
    return isOrganizationWide(user) || job.managerId === user.userId;
  }
  return (
    hasPermission(user.role, 'job:read:assigned') &&
    job.assignedWorkerId === user.userId
  );
}

/** Whether the job's status (and type) allows the action at all, regardless of who asks. */
export function statusAllows(
  type: JobType,
  status: JobStatus,
  action: JobAction,
): boolean {
  const transition = ACTION_TRANSITION[action];
  if (transition !== undefined) {
    return nextStatus(type, status, transition) !== undefined;
  }
  switch (action) {
    case JobAction.EDIT:
      return isEditable(status);
    case JobAction.DELETE:
      return isDeletable(status);
    default:
      // Notes, photos and messages are welcome in any status ("found a leak after
      // finishing", follow-up questions).
      return true;
  }
}

/**
 * Permissions that only the job's assigned worker may use on it. (`job:message` is not in the
 * list because staff hold it too; a worker still messages only on their own jobs, because
 * canView shows a worker nothing else.)
 */
const ASSIGNEE_ONLY: readonly JobPermission[] = [
  'job:work',
  'job:note',
  'job:evidence',
];

/**
 * Whether the user holds the permission for the action AND stands in the right relationship
 * to the job. Status is checked separately so the service can tell "not allowed" (403) from
 * "not now" (409).
 */
export function isPermitted(
  user: AuthenticatedUser,
  job: JobAccessFacts,
  action: JobAction,
): boolean {
  const permission = ACTION_PERMISSION[action];
  if (!hasPermission(user.role, permission) || !canView(user, job)) {
    return false;
  }
  return (
    !ASSIGNEE_ONLY.includes(permission) || job.assignedWorkerId === user.userId
  );
}

const ACTION_ORDER: readonly JobAction[] = [
  JobAction.ACCEPT,
  JobAction.DEPART,
  JobAction.ARRIVE,
  JobAction.START,
  JobAction.COMPLETE,
  JobAction.SUBMIT,
  JobAction.NOTE,
  JobAction.EVIDENCE,
  JobAction.MESSAGE,
  JobAction.DECLINE,
  JobAction.FAIL,
  JobAction.VERIFY,
  JobAction.REJECT,
  JobAction.ASSIGN,
  JobAction.RESCHEDULE,
  JobAction.EDIT,
  JobAction.CANCEL,
  JobAction.DELETE,
];

/** The actions the user can perform on the job right now, in display order. */
export function allowedActions(
  user: AuthenticatedUser,
  job: JobAccessFacts,
): JobAction[] {
  return ACTION_ORDER.filter(
    action =>
      isPermitted(user, job, action) &&
      statusAllows(job.type, job.status, action),
  );
}
