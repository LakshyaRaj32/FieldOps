import {
  JobAction,
  JobEventType,
  JobStatus,
  type JobHistoryEntry,
} from '@fieldops/types';

import type { OutboxEntry } from './data/types';
import {
  describeActionLocation,
  describeHistoryEntry,
  describeProblem,
  describeSync,
  formatDistance,
  formatSchedule,
  formatTime,
  jobCommands,
  LIST_VIEWS,
  priorityBadge,
} from './presentation';

const asha = { id: 'w1', firstName: 'Asha', lastName: 'Verma' };
const ravi = { id: 'm1', firstName: 'Ravi', lastName: 'Kumar' };

describe('jobCommands', () => {
  it('offers Start job for an ASSIGNED job the worker may start', () => {
    const commands = jobCommands({
      allowedActions: [JobAction.START],
      assignedWorker: asha,
    });
    expect(commands.map(c => [c.label, c.variant])).toEqual([
      ['Start job', 'primary'],
    ]);
  });

  it('offers Complete job, with a confirmation, for an IN_PROGRESS job', () => {
    const [complete] = jobCommands({
      allowedActions: [JobAction.COMPLETE],
      assignedWorker: asha,
    });
    expect(complete?.label).toBe('Complete job');
    expect(complete?.confirm?.confirmLabel).toBe('Complete');
  });

  it('offers nothing when the server allows nothing (another role, or a closed job)', () => {
    expect(jobCommands({ allowedActions: [], assignedWorker: asha })).toEqual(
      [],
    );
  });

  it('shows exactly the allowed actions, in order, never extra ones', () => {
    const commands = jobCommands({
      allowedActions: [
        JobAction.ASSIGN,
        JobAction.EDIT,
        JobAction.CANCEL,
        JobAction.DELETE,
      ],
      assignedWorker: null,
    });
    expect(commands.map(c => c.action)).toEqual([
      'assign',
      'edit',
      'cancel',
      'delete',
    ]);
    expect(commands.map(c => c.label)).not.toContain('Start job');
    // Destructive commands always ask first.
    expect(
      commands.filter(c => c.variant === 'danger').every(c => c.confirm),
    ).toBe(true);
  });

  it('says Reassign when a worker is already assigned', () => {
    const [assign] = jobCommands({
      allowedActions: [JobAction.ASSIGN],
      assignedWorker: asha,
    });
    expect(assign?.label).toBe('Reassign worker');
  });
});

describe('formatSchedule', () => {
  const now = new Date(2026, 8, 26, 14, 0);

  it.each([
    [new Date(2026, 8, 26, 10, 30), 'Today, 10:30 AM'],
    [new Date(2026, 8, 27, 9, 0), 'Tomorrow, 9:00 AM'],
    [new Date(2026, 8, 25, 16, 15), 'Yesterday, 4:15 PM'],
    [new Date(2026, 8, 28, 12, 5), 'Mon 28 Sep, 12:05 PM'],
    [new Date(2027, 0, 4, 0, 0), 'Mon 4 Jan 2027, 12:00 AM'],
  ])('formats %s as %s', (date, expected) => {
    expect(formatSchedule(date.toISOString(), now)).toBe(expected);
  });

  it('survives an unreadable timestamp', () => {
    expect(formatSchedule('not a date', now)).toBe('Unknown time');
  });

  it('formats times on a 12-hour clock', () => {
    expect(formatTime(new Date(2026, 0, 1, 0, 7))).toBe('12:07 AM');
    expect(formatTime(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
    expect(formatTime(new Date(2026, 0, 1, 23, 59))).toBe('11:59 PM');
  });
});

describe('list views', () => {
  it('splits work to do from closed jobs, with no status in both', () => {
    const active = LIST_VIEWS.active.statuses;
    const closed = LIST_VIEWS.closed.statuses;
    expect([...active, ...closed].sort()).toEqual(
      Object.values(JobStatus).sort(),
    );
    expect(active.filter(status => closed.includes(status))).toEqual([]);
  });
});

describe('priorityBadge', () => {
  it('highlights only high and urgent jobs', () => {
    expect(priorityBadge('URGENT')?.tone).toBe('danger');
    expect(priorityBadge('HIGH')?.tone).toBe('warning');
    expect(priorityBadge('NORMAL')).toBeNull();
    expect(priorityBadge('LOW')).toBeNull();
  });
});

describe('describeHistoryEntry', () => {
  const entry = (overrides: Partial<JobHistoryEntry>): JobHistoryEntry => ({
    id: 'e1',
    type: JobEventType.CREATED,
    fromStatus: null,
    toStatus: JobStatus.PENDING,
    actor: ravi,
    assignee: null,
    reason: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  });

  it('names who did what', () => {
    expect(describeHistoryEntry(entry({}))).toBe('Created by Ravi Kumar');
    expect(
      describeHistoryEntry(
        entry({ type: JobEventType.ASSIGNED, assignee: asha }),
      ),
    ).toBe('Assigned to Asha Verma by Ravi Kumar');
    expect(
      describeHistoryEntry(
        entry({ type: JobEventType.COMPLETED, actor: asha }),
      ),
    ).toBe('Completed by Asha Verma');
  });
});

describe('describeProblem', () => {
  // Cast: the fixture mixes command types and payloads freely; only labels are under test.
  const problem = (overrides: Partial<OutboxEntry>): OutboxEntry =>
    ({
      seq: 1,
      mutationId: 'm-1',
      type: 'job.start',
      jobId: 'job-1',
      jobTitle: 'AC repair',
      payload: null,
      baseVersion: 2,
      occurredAt: '2026-09-27T09:00:00.000Z',
      status: 'conflict',
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastError: { code: 'INVALID_STATUS_TRANSITION', message: 'x' },
      createdAt: '2026-09-27T09:00:00.000Z',
      ...overrides,
    } as OutboxEntry);

  it('explains a state conflict and a lost assignment differently', () => {
    expect(describeProblem(problem({}))).toBe(
      '“Start job” on AC repair was not applied: the job changed while you were offline. The latest version is shown.',
    );
    expect(
      describeProblem(
        problem({ lastError: { code: 'NOT_FOUND', message: 'x' } }),
      ),
    ).toContain('no longer assigned to you');
  });

  it('explains failures', () => {
    expect(
      describeProblem(
        problem({
          status: 'failed',
          type: 'job.note.add',
          attempts: 10,
          lastError: { code: 'SERVICE_UNAVAILABLE', message: 'x' },
        }),
      ),
    ).toContain('could not be delivered after 10 attempts');
    expect(
      describeProblem(
        problem({
          status: 'failed',
          lastError: { code: 'VALIDATION_ERROR', message: 'x' },
        }),
      ),
    ).toContain('refused by the server (VALIDATION_ERROR)');
  });
});

describe('describeSync', () => {
  const status = (overrides: object) => ({
    phase: 'idle' as const,
    pending: 0,
    failed: 0,
    conflicts: 0,
    lastSyncedAt: null,
    ...overrides,
  });

  it('says nothing when everything is synced', () => {
    expect(describeSync(status({}))).toBeNull();
    expect(describeSync(null)).toBeNull();
  });

  it('reassures while offline, and asks for attention on problems first', () => {
    expect(describeSync(status({ phase: 'offline', pending: 3 }))).toEqual({
      message:
        '3 changes saved on this phone. They will sync when you are back online.',
      tone: 'warning',
    });
    expect(
      describeSync(status({ pending: 1, phase: 'syncing' }))?.message,
    ).toBe('Syncing 1 change…');
    expect(
      describeSync(status({ pending: 2, conflicts: 1, phase: 'offline' })),
    ).toEqual({
      message: '1 change needs attention (Profile › Sync).',
      tone: 'danger',
    });
  });
});

describe('field operations presentation', () => {
  it('formats distances in meters, then kilometers', () => {
    expect(formatDistance(35.4)).toBe('35 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(18_400)).toBe('18 km');
  });

  it('describes where a job was started, with the fix accuracy', () => {
    const location = {
      latitude: 28.6149,
      longitude: 77.209,
      accuracyMeters: 15,
      capturedAt: '2026-09-27T09:00:00.000Z',
    };
    expect(describeActionLocation({ ...location, distanceMeters: 120 })).toBe(
      '120 m from the site (±15 m)',
    );
    expect(describeActionLocation({ ...location, distanceMeters: null })).toBe(
      '28.61490, 77.20900 (±15 m)',
    );
  });

  it('never turns photos or messages into command buttons', () => {
    expect(
      jobCommands({
        allowedActions: [JobAction.EVIDENCE, JobAction.MESSAGE, JobAction.NOTE],
        assignedWorker: null,
      }),
    ).toEqual([]);
  });
});
