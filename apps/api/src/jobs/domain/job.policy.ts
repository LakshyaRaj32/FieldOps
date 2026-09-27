import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { Role } from '../../users/role.js';
import { JobAction, type JobStatus } from '../job-enums.js';
import { isDeletable, isEditable, nextStatus } from '@fieldops/shared';

/**
 * Job authorization. Pure functions, used for every job operation: the controller's route
 * gates (@Roles), the service's resource checks and the `allowedActions` sent to clients all
 * come from here, so there is one source of authorization truth (docs/backend-architecture.md,
 * "Authorization").
 *
 * Two layers, as in the architecture's role model:
 * 1. Permissions per role (JOB_PERMISSIONS). Code asks for a permission, never a role name.
 * 2. The resource relationship: a worker sees and works only the jobs assigned to them.
 *
 * Tenancy: the deployment is a single organization until organizations are introduced, so
 * managers and admins manage every job. When organizations arrive, `canView` gains the
 * organization check and nothing else changes.
 */

export type JobPermission =
  | 'job:create'
  | 'job:read:all'
  | 'job:read:assigned'
  | 'job:edit'
  | 'job:assign'
  | 'job:cancel'
  | 'job:delete'
  | 'job:work'
  | 'job:note'
  | 'job:evidence'
  | 'job:message';

const MANAGERS: readonly Role[] = [Role.MANAGER, Role.ADMIN];
const WORKERS: readonly Role[] = [Role.WORKER];

export const JOB_PERMISSIONS: Readonly<Record<JobPermission, readonly Role[]>> =
  {
    'job:create': MANAGERS,
    'job:read:all': MANAGERS,
    'job:read:assigned': WORKERS,
    'job:edit': MANAGERS,
    'job:assign': MANAGERS,
    'job:cancel': MANAGERS,
    'job:delete': MANAGERS,
    // Starting and completing is field work: only the assigned worker does it.
    'job:work': WORKERS,
    // Field notes come from the assigned worker too.
    'job:note': WORKERS,
    // So do photos (evidence); managers read them through job:read:all.
    'job:evidence': WORKERS,
    // The job's conversation: its worker (see canView) and the managers.
    'job:message': [...WORKERS, ...MANAGERS],
  };

/** The permission each action on an existing job requires. */
export const ACTION_PERMISSION: Readonly<Record<JobAction, JobPermission>> = {
  [JobAction.START]: 'job:work',
  [JobAction.COMPLETE]: 'job:work',
  [JobAction.ASSIGN]: 'job:assign',
  [JobAction.EDIT]: 'job:edit',
  [JobAction.CANCEL]: 'job:cancel',
  [JobAction.DELETE]: 'job:delete',
  [JobAction.NOTE]: 'job:note',
  [JobAction.EVIDENCE]: 'job:evidence',
  [JobAction.MESSAGE]: 'job:message',
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
  readonly status: JobStatus;
  readonly assignedWorkerId: string | null;
}

/**
 * Whether the user may see the job at all. A job the user may not see must be reported as
 * not found (404), so its existence is not revealed to workers probing IDs.
 */
export function canView(user: AuthenticatedUser, job: JobAccessFacts): boolean {
  if (hasPermission(user.role, 'job:read:all')) {
    return true;
  }
  return (
    hasPermission(user.role, 'job:read:assigned') &&
    job.assignedWorkerId === user.userId
  );
}

/** Whether the job's status allows the action at all, regardless of who asks. */
export function statusAllows(status: JobStatus, action: JobAction): boolean {
  switch (action) {
    case JobAction.START:
      return nextStatus(status, 'start') !== undefined;
    case JobAction.COMPLETE:
      return nextStatus(status, 'complete') !== undefined;
    case JobAction.ASSIGN:
      return nextStatus(status, 'assign') !== undefined;
    case JobAction.CANCEL:
      return nextStatus(status, 'cancel') !== undefined;
    case JobAction.EDIT:
      return isEditable(status);
    case JobAction.DELETE:
      return isDeletable(status);
    case JobAction.NOTE:
    case JobAction.EVIDENCE:
      // Evidence is always welcome, also on a closed job ("found a leak after finishing").
      return true;
    case JobAction.MESSAGE:
      // Follow-up questions happen after completion or cancellation too.
      return true;
  }
}

/**
 * Permissions that only the job's assigned worker may use on it. (`job:message` is not in the
 * list because managers hold it too; a worker still messages only on their own jobs, because
 * canView shows a worker nothing else.)
 */
const ASSIGNEE_ONLY: readonly JobPermission[] = [
  'job:work',
  'job:note',
  'job:evidence',
];

/**
 * Whether the user holds the permission for the action AND stands in the right relationship
 * to the job (work actions and notes: the job must be assigned to them). Status is checked separately
 * so the service can tell "not allowed" (403) from "not now" (409).
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
  JobAction.START,
  JobAction.COMPLETE,
  JobAction.NOTE,
  JobAction.EVIDENCE,
  JobAction.MESSAGE,
  JobAction.ASSIGN,
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
      isPermitted(user, job, action) && statusAllows(job.status, action),
  );
}
