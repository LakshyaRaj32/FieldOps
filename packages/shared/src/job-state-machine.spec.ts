import { JobStatus, JobType } from '@fieldops/types';
import {
  decideTransition,
  isChecklistEditable,
  isDeletable,
  isEditable,
  isTerminal,
  lifecycleOf,
  nextStatus,
  OPEN_STATUSES,
  type JobTransition,
} from './job-state-machine';

const {
  PENDING,
  ASSIGNED,
  ACCEPTED,
  EN_ROUTE,
  ARRIVED,
  IN_PROGRESS,
  SUBMITTED,
  COMPLETED,
  CANCELLED,
  FAILED,
} = JobStatus;
const ALL_STATUSES = Object.values(JobStatus);
const TRANSITIONS: JobTransition[] = [
  'assign',
  'accept',
  'decline',
  'depart',
  'arrive',
  'start',
  'complete',
  'submit',
  'verify',
  'reject',
  'fail',
  'cancel',
  'reschedule',
];
const FIELD_TYPES = Object.values(JobType).filter(type => type !== 'GENERAL');

describe('job state machine: basic lifecycle (GENERAL)', () => {
  it.each([
    [PENDING, 'assign', ASSIGNED],
    [PENDING, 'cancel', CANCELLED],
    [PENDING, 'reschedule', PENDING],
    [ASSIGNED, 'assign', ASSIGNED],
    [ASSIGNED, 'start', IN_PROGRESS],
    [ASSIGNED, 'cancel', CANCELLED],
    [ASSIGNED, 'reschedule', ASSIGNED],
    [IN_PROGRESS, 'complete', COMPLETED],
    [IN_PROGRESS, 'cancel', CANCELLED],
  ] as const)('allows %s --%s--> %s', (from, transition, to) => {
    expect(nextStatus('GENERAL', from, transition)).toBe(to);
  });

  it.each([
    [PENDING, 'start'],
    [PENDING, 'complete'],
    [ASSIGNED, 'complete'],
    [ASSIGNED, 'accept'],
    [IN_PROGRESS, 'assign'],
    [IN_PROGRESS, 'start'],
    [IN_PROGRESS, 'submit'],
    [IN_PROGRESS, 'reschedule'],
  ] as const)('rejects %s --%s-->', (from, transition) => {
    expect(nextStatus('GENERAL', from, transition)).toBeUndefined();
  });

  it('never reaches a field-lifecycle status', () => {
    const reachable = new Set<string>();
    for (const from of ALL_STATUSES) {
      for (const transition of TRANSITIONS) {
        const to = nextStatus('GENERAL', from, transition);
        if (to !== undefined) {
          reachable.add(to);
        }
      }
    }
    expect([...reachable].sort()).toEqual(
      [PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED].sort(),
    );
  });
});

describe('job state machine: field lifecycle', () => {
  it('uses the field lifecycle for every business operation type', () => {
    expect(lifecycleOf('GENERAL')).toBe('basic');
    for (const type of FIELD_TYPES) {
      expect(lifecycleOf(type)).toBe('field');
    }
  });

  it('walks the whole happy path in order', () => {
    const path: [JobTransition, JobStatus][] = [
      ['assign', ASSIGNED],
      ['accept', ACCEPTED],
      ['depart', EN_ROUTE],
      ['arrive', ARRIVED],
      ['start', IN_PROGRESS],
      ['submit', SUBMITTED],
      ['verify', COMPLETED],
    ];
    for (const type of FIELD_TYPES) {
      let status: JobStatus = PENDING;
      for (const [transition, expected] of path) {
        const to = nextStatus(type, status, transition);
        expect(to).toBe(expected);
        status = to ?? status;
      }
    }
  });

  it.each([
    [ASSIGNED, 'decline', PENDING],
    [ACCEPTED, 'decline', PENDING],
    [ACCEPTED, 'assign', ASSIGNED],
    [ACCEPTED, 'reschedule', ASSIGNED],
    [ACCEPTED, 'fail', FAILED],
    [EN_ROUTE, 'fail', FAILED],
    [ARRIVED, 'fail', FAILED],
    [IN_PROGRESS, 'fail', FAILED],
    [SUBMITTED, 'reject', IN_PROGRESS],
    [EN_ROUTE, 'cancel', CANCELLED],
    [IN_PROGRESS, 'cancel', CANCELLED],
  ] as const)('allows %s --%s--> %s', (from, transition, to) => {
    expect(nextStatus('PAYMENT_COLLECTION', from, transition)).toBe(to);
  });

  it.each([
    // No skipping steps.
    [ASSIGNED, 'depart'],
    [ASSIGNED, 'start'],
    [ACCEPTED, 'arrive'],
    [ACCEPTED, 'start'],
    [EN_ROUTE, 'start'],
    [ARRIVED, 'submit'],
    [IN_PROGRESS, 'verify'],
    // The basic lifecycle's completion does not exist here: results are verified.
    [IN_PROGRESS, 'complete'],
    // Not reassignable or reschedulable once the worker set off.
    [EN_ROUTE, 'assign'],
    [EN_ROUTE, 'reschedule'],
    [EN_ROUTE, 'decline'],
    // A submitted result is decided, not cancelled.
    [SUBMITTED, 'cancel'],
    [SUBMITTED, 'fail'],
    [PENDING, 'fail'],
    [ASSIGNED, 'fail'],
  ] as const)('rejects %s --%s-->', (from, transition) => {
    expect(nextStatus('DELIVERY', from, transition)).toBeUndefined();
  });
});

describe('job state machine: invariants', () => {
  it('never leaves a terminal status (no reopening, no COMPLETED -> EN_ROUTE)', () => {
    for (const type of Object.values(JobType)) {
      for (const from of [COMPLETED, CANCELLED, FAILED]) {
        expect(isTerminal(from)).toBe(true);
        for (const transition of TRANSITIONS) {
          expect(nextStatus(type, from, transition)).toBeUndefined();
        }
      }
    }
  });

  it('returns to PENDING only when the worker declines', () => {
    for (const type of Object.values(JobType)) {
      for (const from of ALL_STATUSES) {
        for (const transition of TRANSITIONS) {
          if (
            nextStatus(type, from, transition) === PENDING &&
            from !== PENDING
          ) {
            expect(transition).toBe('decline');
          }
        }
      }
    }
  });

  it('lists every non-terminal status as open', () => {
    expect([...OPEN_STATUSES].sort()).toEqual(
      ALL_STATUSES.filter(status => !isTerminal(status)).sort(),
    );
  });

  it('allows edits until the job is closed or under review, checklist edits until accepted', () => {
    expect(ALL_STATUSES.filter(isEditable)).toEqual([
      PENDING,
      ASSIGNED,
      ACCEPTED,
      EN_ROUTE,
      ARRIVED,
      IN_PROGRESS,
    ]);
    expect(ALL_STATUSES.filter(isChecklistEditable)).toEqual([
      PENDING,
      ASSIGNED,
    ]);
  });

  it('allows deleting only unassigned jobs', () => {
    expect(ALL_STATUSES.filter(isDeletable)).toEqual([PENDING]);
  });
});

describe('decideTransition', () => {
  it('applies an allowed transition', () => {
    expect(decideTransition('GENERAL', ASSIGNED, 'start')).toEqual({
      kind: 'apply',
      to: IN_PROGRESS,
    });
    expect(decideTransition('SHOP_VISIT', ARRIVED, 'start')).toEqual({
      kind: 'apply',
      to: IN_PROGRESS,
    });
  });

  it('treats a repeated command as already applied (safe retries)', () => {
    expect(decideTransition('GENERAL', IN_PROGRESS, 'start')).toEqual({
      kind: 'alreadyApplied',
    });
    expect(decideTransition('DELIVERY', ACCEPTED, 'accept')).toEqual({
      kind: 'alreadyApplied',
    });
    expect(decideTransition('DELIVERY', SUBMITTED, 'submit')).toEqual({
      kind: 'alreadyApplied',
    });
    expect(decideTransition('DELIVERY', COMPLETED, 'verify')).toEqual({
      kind: 'alreadyApplied',
    });
  });

  it('never treats reject, decline or reschedule as a retry', () => {
    // A job IN_PROGRESS was not necessarily rejected; a PENDING one not necessarily declined.
    expect(decideTransition('DELIVERY', IN_PROGRESS, 'reject')).toEqual({
      kind: 'rejected',
    });
    expect(decideTransition('DELIVERY', PENDING, 'decline')).toEqual({
      kind: 'rejected',
    });
    expect(decideTransition('DELIVERY', PENDING, 'reschedule')).toEqual({
      kind: 'apply',
      to: PENDING,
    });
  });

  it('rejects a command that would move the job elsewhere', () => {
    expect(decideTransition('GENERAL', COMPLETED, 'start')).toEqual({
      kind: 'rejected',
    });
    expect(decideTransition('PAYMENT_COLLECTION', COMPLETED, 'submit')).toEqual(
      { kind: 'rejected' },
    );
  });

  it('treats assigning the same worker again as a retry, another worker as a reassignment', () => {
    expect(
      decideTransition('GENERAL', ASSIGNED, 'assign', { sameAssignee: true }),
    ).toEqual({ kind: 'alreadyApplied' });
    expect(
      decideTransition('GENERAL', ASSIGNED, 'assign', { sameAssignee: false }),
    ).toEqual({ kind: 'apply', to: ASSIGNED });
    expect(
      decideTransition('DELIVERY', ACCEPTED, 'assign', { sameAssignee: false }),
    ).toEqual({ kind: 'apply', to: ASSIGNED });
  });
});
