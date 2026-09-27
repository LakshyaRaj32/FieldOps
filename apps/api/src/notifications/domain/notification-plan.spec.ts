import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../../events/domain-events.js';
import { Role } from '../../users/role.js';
import {
  planForJobChange,
  planForMessage,
  planForOverdue,
  pushText,
} from './notification-plan.js';

const changed = (overrides: Partial<JobChangedEvent>): JobChangedEvent => ({
  type: 'job.changed',
  organizationId: 'org-a',
  jobId: 'job-1',
  jobTitle: 'AC repair',
  jobType: 'GENERAL',
  change: 'updated',
  status: 'ASSIGNED',
  version: 2,
  actorId: 'manager-1',
  actorName: 'Raj Mehta',
  createdById: 'manager-1',
  managerId: 'manager-1',
  shopId: null,
  shopName: null,
  amount: null,
  currency: 'INR',
  reason: null,
  assignedWorkerId: 'worker-a',
  previousAssigneeId: null,
  ...overrides,
});

const collection = (overrides: Partial<JobChangedEvent>) =>
  changed({
    jobType: 'PAYMENT_COLLECTION',
    jobTitle: 'September dues',
    shopId: 'shop-1',
    shopName: 'Nike Chandigarh',
    amount: 20_000_000,
    ...overrides,
  });

describe('planForJobChange', () => {
  it('tells the worker about a new assignment', () => {
    expect(planForJobChange(changed({ change: 'assigned' }))).toEqual([
      {
        userId: 'worker-a',
        type: 'JOB_ASSIGNED',
        jobId: 'job-1',
        shopId: null,
        title: 'New operation assigned',
        body: '“AC repair”',
      },
    ]);
  });

  it('names the shop and amount of an assigned collection', () => {
    const [plan] = planForJobChange(collection({ change: 'assigned' }));
    expect(plan?.body).toBe(
      'You have been assigned a payment collection of ₹2,00,000 for Nike Chandigarh.',
    );
    expect(plan?.shopId).toBe('shop-1');
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

  it('tells the worker about a new time and a cancellation', () => {
    expect(
      planForJobChange(collection({ change: 'rescheduled' })).map(p => [
        p.userId,
        p.type,
        p.body,
      ]),
    ).toEqual([
      [
        'worker-a',
        'JOB_RESCHEDULED',
        'Your payment collection for Nike Chandigarh has been rescheduled.',
      ],
    ]);
    expect(
      planForJobChange(changed({ change: 'cancelled' })).map(p => p.userId),
    ).toEqual(['worker-a']);
    expect(
      planForJobChange(
        changed({ change: 'cancelled', assignedWorkerId: null }),
      ),
    ).toEqual([]);
  });

  it('asks the responsible manager to verify a submitted collection', () => {
    const [plan] = planForJobChange(
      collection({
        change: 'submitted',
        actorId: 'worker-a',
        actorName: 'Rahul Verma',
        managerId: 'manager-2',
      }),
    );
    expect(plan).toMatchObject({
      userId: 'manager-2',
      type: 'JOB_SUBMITTED',
      title: 'Payment collection requires verification',
      body: 'Rahul Verma submitted a ₹2,00,000 collection from Nike Chandigarh.',
    });
  });

  it('tells the manager about a decline or failure, with the reason', () => {
    const [declined] = planForJobChange(
      collection({
        change: 'declined',
        actorId: 'worker-a',
        actorName: 'Rahul Verma',
        reason: 'On leave',
        assignedWorkerId: null,
      }),
    );
    expect(declined).toMatchObject({
      userId: 'manager-1',
      type: 'JOB_DECLINED',
      body: 'Rahul Verma declined the payment collection for Nike Chandigarh. Reason: On leave',
    });
    const [failed] = planForJobChange(
      collection({
        change: 'failed',
        actorId: 'worker-a',
        reason: 'Shop closed',
      }),
    );
    expect(failed).toMatchObject({ userId: 'manager-1', type: 'JOB_FAILED' });
  });

  it('tells the worker whether the submission was verified or sent back', () => {
    expect(
      planForJobChange(collection({ change: 'verified' })).map(p => p.type),
    ).toEqual(['JOB_COMPLETED']);
    const [rejected] = planForJobChange(
      collection({ change: 'rejected', reason: 'Receipt unreadable' }),
    );
    expect(rejected).toMatchObject({
      userId: 'worker-a',
      type: 'JOB_REJECTED',
      body: 'Your payment collection for Nike Chandigarh was sent back. Reason: Receipt unreadable',
    });
  });

  it('tells the responsible manager when a basic job is completed', () => {
    expect(
      planForJobChange(
        changed({
          change: 'completed',
          actorId: 'worker-a',
          managerId: 'manager-9',
        }),
      ).map(plan => [plan.userId, plan.type]),
    ).toEqual([['manager-9', 'JOB_COMPLETED']]);
  });

  it('stays quiet for routine steps', () => {
    for (const change of [
      'accepted',
      'departed',
      'arrived',
      'started',
      'updated',
      'note',
      'evidence',
    ] as const) {
      expect(
        planForJobChange(changed({ change, actorId: 'worker-a' })),
      ).toEqual([]);
    }
  });

  it('never notifies the person who acted', () => {
    expect(
      planForJobChange(changed({ change: 'completed', actorId: 'manager-1' })),
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
    organizationId: 'org-a',
    jobId: 'job-1',
    jobTitle: 'AC repair',
    messageId: 'm-1',
    authorId: 'worker-a',
    authorRole: Role.WORKER,
    createdById: 'manager-1',
    managerId: 'manager-2',
    assignedWorkerId: 'worker-a',
    ...overrides,
  });

  it("sends a worker's message to the responsible manager", () => {
    expect(planForMessage(message({})).map(plan => plan.userId)).toEqual([
      'manager-2',
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

describe('planForOverdue', () => {
  it("tells each of the shop's stakeholders, about the shop", () => {
    const plans = planForOverdue({
      type: 'payment.overdue',
      organizationId: 'org-a',
      shopId: 'shop-1',
      shopName: 'Nike Chandigarh',
      orderId: 'order-1',
      orderNumber: 'ORD-1001',
      outstanding: 30_000_000,
      currency: 'INR',
      recipientIds: ['manager-1', 'admin-1'],
    });
    expect(plans).toEqual([
      expect.objectContaining({
        userId: 'manager-1',
        jobId: null,
        shopId: 'shop-1',
      }),
      expect.objectContaining({ userId: 'admin-1' }),
    ]);
    expect(plans[0]?.body).toBe(
      'Nike Chandigarh has an overdue payment of ₹3,00,000 (ORD-1001).',
    );
  });
});

describe('pushText', () => {
  it('never includes business content', () => {
    expect(pushText('PAYMENT_OVERDUE')).toEqual({
      title: 'Overdue payment',
      body: 'Open FieldOps to see the details.',
    });
  });
});
