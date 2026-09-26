import { JobStatus } from '../job-enums.js';
import {
  decideTransition,
  isChecklistEditable,
  isDeletable,
  isEditable,
  isTerminal,
  nextStatus,
  type JobTransition,
} from './job-state-machine.js';

const { PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED } = JobStatus;
const ALL_STATUSES = [PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED];
const TRANSITIONS: JobTransition[] = ['assign', 'start', 'complete', 'cancel'];

describe('job state machine', () => {
  it.each([
    [PENDING, 'assign', ASSIGNED],
    [PENDING, 'cancel', CANCELLED],
    [ASSIGNED, 'assign', ASSIGNED],
    [ASSIGNED, 'start', IN_PROGRESS],
    [ASSIGNED, 'cancel', CANCELLED],
    [IN_PROGRESS, 'complete', COMPLETED],
    [IN_PROGRESS, 'cancel', CANCELLED],
  ] as const)('allows %s --%s--> %s', (from, transition, to) => {
    expect(nextStatus(from, transition)).toBe(to);
  });

  it.each([
    [PENDING, 'start'],
    [PENDING, 'complete'],
    [ASSIGNED, 'complete'],
    [IN_PROGRESS, 'assign'],
    [IN_PROGRESS, 'start'],
  ] as const)('rejects %s --%s-->', (from, transition) => {
    expect(nextStatus(from, transition)).toBeUndefined();
  });

  it('never leaves a terminal status (no reopening, no COMPLETED -> PENDING)', () => {
    for (const from of [COMPLETED, CANCELLED]) {
      expect(isTerminal(from)).toBe(true);
      for (const transition of TRANSITIONS) {
        expect(nextStatus(from, transition)).toBeUndefined();
      }
    }
  });

  it('can never move a job back to PENDING', () => {
    for (const from of ALL_STATUSES) {
      for (const transition of TRANSITIONS) {
        expect(nextStatus(from, transition)).not.toBe(PENDING);
      }
    }
  });

  it('allows edits until the job is closed, checklist edits until it starts', () => {
    expect(ALL_STATUSES.filter(isEditable)).toEqual([
      PENDING,
      ASSIGNED,
      IN_PROGRESS,
    ]);
    expect(ALL_STATUSES.filter(isChecklistEditable)).toEqual([
      PENDING,
      ASSIGNED,
    ]);
  });

  it('allows deletion only of never-assigned jobs', () => {
    expect(ALL_STATUSES.filter(isDeletable)).toEqual([PENDING]);
  });
});

describe('decideTransition', () => {
  it('applies valid transitions', () => {
    expect(decideTransition(ASSIGNED, 'start')).toEqual({
      kind: 'apply',
      to: IN_PROGRESS,
    });
    expect(decideTransition(IN_PROGRESS, 'complete')).toEqual({
      kind: 'apply',
      to: COMPLETED,
    });
  });

  it('treats a repeated command as already applied (idempotent retries)', () => {
    expect(decideTransition(IN_PROGRESS, 'start')).toEqual({
      kind: 'alreadyApplied',
    });
    expect(decideTransition(COMPLETED, 'complete')).toEqual({
      kind: 'alreadyApplied',
    });
    expect(decideTransition(CANCELLED, 'cancel')).toEqual({
      kind: 'alreadyApplied',
    });
  });

  it('distinguishes re-assigning the same worker from reassigning another one', () => {
    expect(
      decideTransition(ASSIGNED, 'assign', { sameAssignee: true }),
    ).toEqual({ kind: 'alreadyApplied' });
    expect(
      decideTransition(ASSIGNED, 'assign', { sameAssignee: false }),
    ).toEqual({ kind: 'apply', to: ASSIGNED });
  });

  it('rejects commands that would go anywhere else', () => {
    expect(decideTransition(PENDING, 'complete')).toEqual({
      kind: 'rejected',
    });
    expect(decideTransition(COMPLETED, 'start')).toEqual({ kind: 'rejected' });
    expect(decideTransition(CANCELLED, 'complete')).toEqual({
      kind: 'rejected',
    });
    expect(decideTransition(IN_PROGRESS, 'assign')).toEqual({
      kind: 'rejected',
    });
  });
});
