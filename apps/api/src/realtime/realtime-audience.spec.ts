import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../events/domain-events.js';
import { Role } from '../users/role.js';
import {
  jobChangedDeliveries,
  messageDeliveries,
  organizationStaffRoom,
  roomsFor,
} from './realtime-audience.js';

const STAFF = organizationStaffRoom('org-a');

const changed = (
  overrides: Partial<JobChangedEvent> = {},
): JobChangedEvent => ({
  type: 'job.changed',
  organizationId: 'org-a',
  jobId: 'job-1',
  jobTitle: 'AC repair',
  jobType: 'GENERAL',
  change: 'started',
  status: 'IN_PROGRESS',
  version: 4,
  actorId: 'worker-a',
  actorName: 'Asha Verma',
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

const principal = (
  role: Role,
  userId: string,
  options: { organizationId?: string | null; wide?: boolean } = {},
): AuthenticatedUser => ({
  userId,
  sessionId: `session-${userId}`,
  role,
  organizationId:
    options.organizationId === undefined ? 'org-a' : options.organizationId,
  organizationWideAccess: options.wide ?? false,
});

describe('roomsFor', () => {
  it('puts every connection in its user and session rooms', () => {
    expect(roomsFor(principal(Role.WORKER, 'worker-a'))).toEqual([
      'user:worker-a',
      'session:session-worker-a',
    ]);
  });

  it("adds organization-wide staff to their own organization's staff room only", () => {
    expect(roomsFor(principal(Role.ORGANIZATION_ADMIN, 'a'))).toContain(STAFF);
    expect(roomsFor(principal(Role.MANAGER, 'm', { wide: true }))).toContain(
      STAFF,
    );
    expect(
      roomsFor(
        principal(Role.ORGANIZATION_ADMIN, 'b', { organizationId: 'org-b' }),
      ),
    ).toContain(organizationStaffRoom('org-b'));
    // A scoped manager hears about their own operations through their user room.
    expect(roomsFor(principal(Role.MANAGER, 'm'))).not.toContain(STAFF);
    expect(roomsFor(principal(Role.WORKER, 'w'))).not.toContain(STAFF);
    expect(
      roomsFor(principal(Role.SUPER_ADMIN, 's', { organizationId: null })),
    ).toEqual(['user:s', 'session:session-s']);
  });
});

describe('jobChangedDeliveries', () => {
  it('reaches its organization staff, its manager and its worker, with IDs and status', () => {
    expect(jobChangedDeliveries(changed())).toEqual([
      {
        rooms: [STAFF, 'user:manager-1', 'user:worker-a'],
        type: 'job.changed',
        data: {
          jobId: 'job-1',
          change: 'started',
          status: 'IN_PROGRESS',
          version: 4,
        },
      },
    ]);
  });

  it('never reaches another organization', () => {
    for (const delivery of jobChangedDeliveries(changed())) {
      expect(delivery.rooms).not.toContain(organizationStaffRoom('org-b'));
    }
  });

  it('reaches only staff while a job has no worker', () => {
    const [delivery] = jobChangedDeliveries(
      changed({ assignedWorkerId: null, change: 'updated', status: 'PENDING' }),
    );
    expect(delivery?.rooms).toEqual([STAFF, 'user:manager-1']);
  });

  it('tells a worker a job was taken from, without its status', () => {
    const deliveries = jobChangedDeliveries(
      changed({
        change: 'assigned',
        status: 'ASSIGNED',
        assignedWorkerId: 'worker-b',
        previousAssigneeId: 'worker-a',
      }),
    );
    expect(deliveries).toEqual([
      expect.objectContaining({
        rooms: [STAFF, 'user:manager-1', 'user:worker-b'],
      }),
      {
        rooms: ['user:worker-a'],
        type: 'job.changed',
        data: { jobId: 'job-1', change: 'unassigned' },
      },
    ]);
  });

  it('never contains the job title or other content', () => {
    for (const delivery of jobChangedDeliveries(changed())) {
      expect(JSON.stringify(delivery)).not.toContain('AC repair');
    }
  });
});

describe('messageDeliveries', () => {
  it('reaches the conversation: staff, the manager and the assigned worker', () => {
    const event: JobMessageCreatedEvent = {
      type: 'job.message.created',
      organizationId: 'org-a',
      jobId: 'job-1',
      jobTitle: 'AC repair',
      messageId: 'message-1',
      authorId: 'manager-1',
      authorRole: Role.MANAGER,
      createdById: 'manager-1',
      managerId: 'manager-1',
      assignedWorkerId: 'worker-a',
    };
    expect(messageDeliveries(event)).toEqual([
      {
        rooms: [STAFF, 'user:manager-1', 'user:worker-a'],
        type: 'job.message.created',
        data: { jobId: 'job-1', messageId: 'message-1' },
      },
    ]);
  });
});
