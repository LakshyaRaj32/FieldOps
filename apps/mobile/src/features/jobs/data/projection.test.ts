import { serverJob, WORKER } from '../../../testing/fakeJobServer';
import { projectJob, workerActions } from './projection';
import type { OutboxEntry, OutboxType } from './types';

let seq = 0;
const entry = (
  type: OutboxType,
  overrides: Partial<OutboxEntry> = {},
): OutboxEntry => {
  seq += 1;
  return {
    seq,
    mutationId: `m-${seq}`,
    type,
    jobId: 'job-1',
    jobTitle: 'AC repair',
    payload: null,
    baseVersion: 2,
    occurredAt: `2026-09-27T09:0${seq}:00.000Z`,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null,
    createdAt: '2026-09-27T09:00:00.000Z',
    ...overrides,
  };
};

describe('projectJob', () => {
  it('shows a pending start as in progress, with the device time', () => {
    const start = entry('job.start');
    const local = projectJob(serverJob(), [start], WORKER);

    expect(local.status).toBe('IN_PROGRESS');
    expect(local.startedAt).toBe(start.occurredAt);
    expect(local.allowedActions).toEqual(['complete', 'note']);
  });

  it('applies commands in order: start, then complete', () => {
    const local = projectJob(
      serverJob(),
      [entry('job.start'), entry('job.complete')],
      WORKER,
    );
    expect(local.status).toBe('COMPLETED');
    expect(local.allowedActions).toEqual(['note']);
  });

  it('adds pending notes once, authored by the worker', () => {
    const note = entry('job.note.add', {
      payload: { noteId: 'note-1', body: 'Filter replaced' },
    });
    const local = projectJob(serverJob(), [note, note], WORKER);

    expect(local.fieldNotes).toEqual([
      expect.objectContaining({
        id: 'note-1',
        body: 'Filter replaced',
        author: WORKER,
      }),
    ]);
  });

  it('does not apply a command the newer server state no longer allows', () => {
    const cancelled = serverJob({ status: 'CANCELLED' });
    const local = projectJob(
      cancelled,
      [entry('job.start'), entry('job.complete')],
      WORKER,
    );

    expect(local.status).toBe('CANCELLED');
    expect(local.allowedActions).toEqual(['note']);
  });

  it('keeps the server copy untouched', () => {
    const server = serverJob();
    projectJob(server, [entry('job.start')], WORKER);
    expect(server.status).toBe('ASSIGNED');
  });
});

describe('workerActions', () => {
  it('follows the shared state machine', () => {
    expect(workerActions('ASSIGNED')).toEqual(['start', 'note']);
    expect(workerActions('IN_PROGRESS')).toEqual(['complete', 'note']);
    expect(workerActions('COMPLETED')).toEqual(['note']);
    expect(workerActions('PENDING')).toEqual(['note']);
  });
});
