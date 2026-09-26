import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { Role } from '../../users/role.js';
import { JobAction, JobStatus } from '../job-enums.js';
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
): AuthenticatedUser => ({
  userId,
  sessionId: 'session-1',
  role,
});

const workerA = user(Role.WORKER, 'worker-a');
const workerB = user(Role.WORKER, 'worker-b');
const manager = user(Role.MANAGER);
const admin = user(Role.ADMIN);

const job = (
  status: JobStatus,
  assignedWorkerId: string | null = 'worker-a',
): JobAccessFacts => ({ status, assignedWorkerId });

describe('job permissions', () => {
  it('lets managers and admins manage jobs, and only workers work them', () => {
    expect(rolesWith('job:create')).toEqual([Role.MANAGER, Role.ADMIN]);
    expect(rolesWith('job:assign')).toEqual([Role.MANAGER, Role.ADMIN]);
    expect(rolesWith('job:work')).toEqual([Role.WORKER]);
    expect(hasPermission(Role.WORKER, 'job:assign')).toBe(false);
    expect(hasPermission(Role.WORKER, 'job:create')).toBe(false);
    expect(hasPermission(Role.MANAGER, 'job:work')).toBe(false);
  });
});

describe('canView', () => {
  it('shows a worker only the jobs assigned to them', () => {
    expect(canView(workerA, job(JobStatus.ASSIGNED, 'worker-a'))).toBe(true);
    expect(canView(workerB, job(JobStatus.ASSIGNED, 'worker-a'))).toBe(false);
    expect(canView(workerA, job(JobStatus.PENDING, null))).toBe(false);
  });

  it('shows managers and admins every job (single organization)', () => {
    expect(canView(manager, job(JobStatus.PENDING, null))).toBe(true);
    expect(canView(admin, job(JobStatus.IN_PROGRESS))).toBe(true);
  });
});

describe('isPermitted', () => {
  it('lets only the assigned worker start or complete a job', () => {
    const assigned = job(JobStatus.ASSIGNED, 'worker-a');
    expect(isPermitted(workerA, assigned, JobAction.START)).toBe(true);
    expect(isPermitted(workerB, assigned, JobAction.START)).toBe(false);
    expect(isPermitted(workerB, assigned, JobAction.COMPLETE)).toBe(false);
  });

  it('never lets managers or admins do the field work', () => {
    const assigned = job(JobStatus.ASSIGNED);
    expect(isPermitted(manager, assigned, JobAction.START)).toBe(false);
    expect(isPermitted(admin, assigned, JobAction.COMPLETE)).toBe(false);
  });

  it('never lets workers manage jobs, not even their own', () => {
    const own = job(JobStatus.ASSIGNED, 'worker-a');
    for (const action of [
      JobAction.ASSIGN,
      JobAction.EDIT,
      JobAction.CANCEL,
      JobAction.DELETE,
    ]) {
      expect(isPermitted(workerA, own, action)).toBe(false);
    }
  });
});

describe('allowedActions', () => {
  it.each([
    [JobStatus.ASSIGNED, ['start']],
    [JobStatus.IN_PROGRESS, ['complete']],
    [JobStatus.COMPLETED, []],
    [JobStatus.CANCELLED, []],
  ] as const)(
    'offers the assigned worker on a %s job: %j',
    (status, actions) => {
      expect(allowedActions(workerA, job(status, 'worker-a'))).toEqual(actions);
    },
  );

  it('offers other workers nothing', () => {
    expect(
      allowedActions(workerB, job(JobStatus.ASSIGNED, 'worker-a')),
    ).toEqual([]);
  });

  it.each([
    [JobStatus.PENDING, null, ['assign', 'edit', 'cancel', 'delete']],
    [JobStatus.ASSIGNED, 'worker-a', ['assign', 'edit', 'cancel']],
    [JobStatus.IN_PROGRESS, 'worker-a', ['edit', 'cancel']],
    [JobStatus.COMPLETED, 'worker-a', []],
    [JobStatus.CANCELLED, null, []],
  ] as const)(
    'offers managers and admins on a %s job: %j',
    (status, assignee, actions) => {
      expect(allowedActions(manager, job(status, assignee))).toEqual(actions);
      expect(allowedActions(admin, job(status, assignee))).toEqual(actions);
    },
  );
});
