import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { Role } from '../../users/role.js';
import { JobAction, JobStatus, JobType } from '../job-enums.js';
import {
  allowedActions,
  canView,
  hasPermission,
  isPermitted,
  rolesWith,
  type JobAccessFacts,
} from './job.policy.js';

const user = (
  role: Role,
  userId = `${role.toLowerCase()}-1`,
  options: { organizationId?: string | null; organizationWide?: boolean } = {},
): AuthenticatedUser => ({
  userId,
  sessionId: `session-${userId}`,
  role,
  organizationId:
    options.organizationId === undefined ? 'org-a' : options.organizationId,
  organizationWideAccess: options.organizationWide ?? false,
});

const workerA = user(Role.WORKER, 'worker-a');
const workerB = user(Role.WORKER, 'worker-b');
const manager = user(Role.MANAGER, 'manager-1');
const otherManager = user(Role.MANAGER, 'manager-2');
const wideManager = user(Role.MANAGER, 'manager-3', { organizationWide: true });
const admin = user(Role.ORGANIZATION_ADMIN, 'admin-1');
const foreignAdmin = user(Role.ORGANIZATION_ADMIN, 'admin-b', {
  organizationId: 'org-b',
});
const foreignWorker = user(Role.WORKER, 'worker-a', {
  organizationId: 'org-b',
});
const superAdmin = user(Role.SUPER_ADMIN, 'root', { organizationId: null });

const job = (
  status: JobStatus,
  assignedWorkerId: string | null = 'worker-a',
  type: JobType = JobType.GENERAL,
): JobAccessFacts => ({
  organizationId: 'org-a',
  type,
  status,
  assignedWorkerId,
  managerId: 'manager-1',
});

describe('job permissions', () => {
  it('lets staff manage operations, and only workers work them', () => {
    expect(rolesWith('job:create')).toEqual([
      Role.MANAGER,
      Role.ORGANIZATION_ADMIN,
    ]);
    expect(rolesWith('job:review')).toEqual([
      Role.MANAGER,
      Role.ORGANIZATION_ADMIN,
    ]);
    expect(rolesWith('job:work')).toEqual([Role.WORKER]);
    expect(hasPermission(Role.WORKER, 'job:assign')).toBe(false);
    expect(hasPermission(Role.WORKER, 'job:review')).toBe(false);
    expect(hasPermission(Role.MANAGER, 'job:work')).toBe(false);
  });

  it('gives the platform super admin no operation permission at all', () => {
    for (const permission of [
      'job:create',
      'job:read:all',
      'job:work',
      'job:review',
    ] as const) {
      expect(hasPermission(Role.SUPER_ADMIN, permission)).toBe(false);
    }
  });
});

describe('canView', () => {
  it('shows a worker only the jobs assigned to them', () => {
    expect(canView(workerA, job(JobStatus.ASSIGNED, 'worker-a'))).toBe(true);
    expect(canView(workerB, job(JobStatus.ASSIGNED, 'worker-a'))).toBe(false);
    expect(canView(workerA, job(JobStatus.PENDING, null))).toBe(false);
  });

  it('never shows an operation outside its organization', () => {
    expect(canView(foreignAdmin, job(JobStatus.PENDING, null))).toBe(false);
    // Same user ID, other organization: still nothing.
    expect(canView(foreignWorker, job(JobStatus.ASSIGNED, 'worker-a'))).toBe(
      false,
    );
    expect(canView(superAdmin, job(JobStatus.PENDING, null))).toBe(false);
  });

  it('shows a manager their own operations, organization-wide staff all', () => {
    expect(canView(manager, job(JobStatus.PENDING, null))).toBe(true);
    expect(canView(otherManager, job(JobStatus.PENDING, null))).toBe(false);
    expect(canView(wideManager, job(JobStatus.PENDING, null))).toBe(true);
    expect(canView(admin, job(JobStatus.IN_PROGRESS))).toBe(true);
  });
});

describe('isPermitted', () => {
  it('lets only the assigned worker work a job', () => {
    const assigned = job(JobStatus.ASSIGNED, 'worker-a');
    expect(isPermitted(workerA, assigned, JobAction.START)).toBe(true);
    expect(isPermitted(workerB, assigned, JobAction.START)).toBe(false);
    expect(isPermitted(manager, assigned, JobAction.START)).toBe(false);
  });

  it('lets responsible and organization-wide staff review, not other managers', () => {
    const submitted = job(JobStatus.SUBMITTED, 'worker-a', JobType.DELIVERY);
    expect(isPermitted(manager, submitted, JobAction.VERIFY)).toBe(true);
    expect(isPermitted(admin, submitted, JobAction.VERIFY)).toBe(true);
    expect(isPermitted(otherManager, submitted, JobAction.VERIFY)).toBe(false);
    expect(isPermitted(workerA, submitted, JobAction.VERIFY)).toBe(false);
  });

  it('lets the worker and staff message, nobody else', () => {
    const assigned = job(JobStatus.ASSIGNED, 'worker-a');
    expect(isPermitted(workerA, assigned, JobAction.MESSAGE)).toBe(true);
    expect(isPermitted(manager, assigned, JobAction.MESSAGE)).toBe(true);
    expect(isPermitted(workerB, assigned, JobAction.MESSAGE)).toBe(false);
  });
});

describe('allowedActions', () => {
  it('offers a basic job exactly the Phase 2 steps', () => {
    expect(allowedActions(workerA, job(JobStatus.ASSIGNED))).toEqual([
      JobAction.START,
      JobAction.NOTE,
      JobAction.EVIDENCE,
      JobAction.MESSAGE,
    ]);
    expect(allowedActions(workerA, job(JobStatus.IN_PROGRESS))).toEqual([
      JobAction.COMPLETE,
      JobAction.NOTE,
      JobAction.EVIDENCE,
      JobAction.MESSAGE,
    ]);
  });

  it('walks a worker through the field lifecycle one step at a time', () => {
    const at = (status: JobStatus) =>
      allowedActions(
        workerA,
        job(status, 'worker-a', JobType.PAYMENT_COLLECTION),
      );
    expect(at(JobStatus.ASSIGNED)).toEqual([
      JobAction.ACCEPT,
      JobAction.NOTE,
      JobAction.EVIDENCE,
      JobAction.MESSAGE,
      JobAction.DECLINE,
    ]);
    expect(at(JobStatus.ACCEPTED)).toContain(JobAction.DEPART);
    expect(at(JobStatus.ACCEPTED)).not.toContain(JobAction.START);
    expect(at(JobStatus.EN_ROUTE)).toContain(JobAction.ARRIVE);
    expect(at(JobStatus.ARRIVED)).toContain(JobAction.START);
    expect(at(JobStatus.IN_PROGRESS)).toContain(JobAction.SUBMIT);
    expect(at(JobStatus.IN_PROGRESS)).not.toContain(JobAction.COMPLETE);
    expect(at(JobStatus.SUBMITTED)).toEqual([
      JobAction.NOTE,
      JobAction.EVIDENCE,
      JobAction.MESSAGE,
    ]);
  });

  it('offers review only on a submitted result, and no editing', () => {
    const submitted = job(JobStatus.SUBMITTED, 'worker-a', JobType.DELIVERY);
    expect(allowedActions(manager, submitted)).toEqual([
      JobAction.MESSAGE,
      JobAction.VERIFY,
      JobAction.REJECT,
    ]);
  });

  it('offers nothing but conversation on a completed operation', () => {
    const done = job(JobStatus.COMPLETED, 'worker-a', JobType.DELIVERY);
    expect(allowedActions(manager, done)).toEqual([JobAction.MESSAGE]);
  });

  it('offers a foreign organization nothing', () => {
    expect(allowedActions(foreignAdmin, job(JobStatus.PENDING, null))).toEqual(
      [],
    );
  });
});
