import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../events/domain-events.js';
import { Role } from '../users/role.js';
import {
  jobChangedDeliveries,
  MANAGERS_ROOM,
  messageDeliveries,
  roomsFor,
} from './realtime-audience.js';

const changed = (overrides: Partial<JobChangedEvent> = {}): JobChangedEvent => ({
  type: 'job.changed',
  jobId: 'job-1',
  jobTitle: 'AC repair',
  change: 'started',
  status: 'IN_PROGRESS',
  version: 4,
  actorId: 'worker-a',
  createdById: 'manager-1',
  assignedWorkerId: 'worker-a',
  previousAssigneeId: null,
  ...overrides,
});

const principal = (role: Role, userId: string): AuthenticatedUser => ({
  userId,
  sessionId: `session-${userId}`,
  role,
});

describe('roomsFor', () => {
  it('puts every connection in its user and session rooms', () => {
    expect(roomsFor(principal(Role.WORKER, 'worker-a'))).toEqual([
      'user:worker-a',
      'session:session-worker-a',
    ]);
  });

  it('adds managers and admins (job:read:all) to the managers room', () => {
    expect(roomsFor(principal(Role.MANAGER, 'm'))).toContain(MANAGERS_ROOM);
    expect(roomsFor(principal(Role.ADMIN, 'a'))).toContain(MANAGERS_ROOM);
    expect(roomsFor(principal(Role.WORKER, 'w'))).not.toContain(MANAGERS_ROOM);
  });
});

describe('jobChangedDeliveries', () => {
  it('reaches the managers and the assigned worker only, with IDs and status', () => {
    expect(jobChangedDeliveries(changed())).toEqual([
      {
        rooms: [MANAGERS_ROOM, 'user:worker-a'],
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

  it('reaches only managers while a job has no worker', () => {
    const [delivery] = jobChangedDeliveries(
      changed({ assignedWorkerId: null, change: 'updated', status: 'PENDING' }),
    );
    expect(delivery?.rooms).toEqual([MANAGERS_ROOM]);
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
      expect.objectContaining({ rooms: [MANAGERS_ROOM, 'user:worker-b'] }),
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
  it('reaches the job conversation: managers and the assigned worker', () => {
    const event: JobMessageCreatedEvent = {
      type: 'job.message.created',
      jobId: 'job-1',
      jobTitle: 'AC repair',
      messageId: 'message-1',
      authorId: 'manager-1',
      authorRole: Role.MANAGER,
      createdById: 'manager-1',
      assignedWorkerId: 'worker-a',
    };
    expect(messageDeliveries(event)).toEqual([
      {
        rooms: [MANAGERS_ROOM, 'user:worker-a'],
        type: 'job.message.created',
        data: { jobId: 'job-1', messageId: 'message-1' },
      },
    ]);
  });
});
