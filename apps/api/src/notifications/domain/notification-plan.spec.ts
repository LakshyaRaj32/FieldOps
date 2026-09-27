import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../../events/domain-events.js';
import { Role } from '../../users/role.js';
import {
  planForJobChange,
  planForMessage,
  pushText,
} from './notification-plan.js';

const changed = (overrides: Partial<JobChangedEvent>): JobChangedEvent => ({
  type: 'job.changed',
  jobId: 'job-1',
  jobTitle: 'AC repair',
  change: 'updated',
  status: 'ASSIGNED',
  version: 2,
  actorId: 'manager-1',
  createdById: 'manager-1',
  assignedWorkerId: 'worker-a',
  previousAssigneeId: null,
  ...overrides,
});

describe('planForJobChange', () => {
  it('tells the worker about a new assignment', () => {
    expect(planForJobChange(changed({ change: 'assigned' }))).toEqual([
      {
        userId: 'worker-a',
        type: 'JOB_ASSIGNED',
        jobId: 'job-1',
        title: 'New job assigned',
        body: '“AC repair”',
      },
    ]);
  });

  it('tells both workers about a reassignment', () => {
    const plans = planForJobChange(
      changed({
        change: 'assigned',
        assignedWorkerId: 'worker-b',
        previousAssigneeId: 'worker-a',
      }),
    );
    expect(plans.map(plan => [plan.userId, plan.type])).toEqual([
      ['worker-b', 'JOB_ASSIGNED'],
      ['worker-a', 'JOB_UNASSIGNED'],
    ]);
  });

  it('tells the assigned worker about a cancellation, and nobody when unassigned', () => {
    expect(
      planForJobChange(changed({ change: 'cancelled' })).map(p => p.userId),
    ).toEqual(['worker-a']);
    expect(
      planForJobChange(changed({ change: 'cancelled', assignedWorkerId: null })),
    ).toEqual([]);
  });

  it("tells the job's creator when the worker completes it", () => {
    expect(
      planForJobChange(
        changed({ change: 'completed', actorId: 'worker-a' }),
      ).map(plan => [plan.userId, plan.type]),
    ).toEqual([['manager-1', 'JOB_COMPLETED']]);
  });

  it('stays quiet for routine changes', () => {
    for (const change of ['started', 'updated', 'note', 'evidence'] as const) {
      expect(planForJobChange(changed({ change, actorId: 'worker-a' }))).toEqual(
        [],
      );
    }
  });

  it('never notifies the person who acted', () => {
    expect(
      planForJobChange(
        changed({ change: 'completed', actorId: 'manager-1' }),
      ),
    ).toEqual([]);
  });

  it('keeps inbox bodies within the column size', () => {
    const [plan] = planForJobChange(
      changed({ change: 'assigned', jobTitle: 'x'.repeat(400) }),
    );
    expect(plan?.body.length).toBeLessThanOrEqual(300);
  });
});

describe('planForMessage', () => {
  const message = (
    overrides: Partial<JobMessageCreatedEvent>,
  ): JobMessageCreatedEvent => ({
    type: 'job.message.created',
    jobId: 'job-1',
    jobTitle: 'AC repair',
    messageId: 'm-1',
    authorId: 'worker-a',
    authorRole: Role.WORKER,
    createdById: 'manager-1',
    assignedWorkerId: 'worker-a',
    ...overrides,
  });

  it("sends a worker's message to the manager who created the job", () => {
    expect(planForMessage(message({})).map(plan => plan.userId)).toEqual([
      'manager-1',
    ]);
  });

  it("sends a manager's message to the assigned worker", () => {
    expect(
      planForMessage(
        message({ authorId: 'manager-2', authorRole: Role.MANAGER }),
      ).map(plan => plan.userId),
    ).toEqual(['worker-a']);
  });

  it('sends nothing when the other side is missing or is the author', () => {
    expect(
      planForMessage(
        message({
          authorId: 'manager-1',
          authorRole: Role.MANAGER,
          assignedWorkerId: null,
        }),
      ),
    ).toEqual([]);
  });
});

describe('pushText', () => {
  it('never includes job content', () => {
    expect(pushText('JOB_ASSIGNED')).toEqual({
      title: 'New job assigned',
      body: 'Open FieldOps to see the details.',
    });
  });
});
