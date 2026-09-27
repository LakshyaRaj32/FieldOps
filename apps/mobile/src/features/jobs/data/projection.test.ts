import { serverJob, WORKER } from '../../../testing/fakeJobServer';
import { projectJob, workerActions } from './projection';
import type { OutboxCommand, OutboxEntry } from './types';

let seq = 0;
const entry = (
  command: OutboxCommand,
  overrides: Partial<Omit<OutboxEntry, 'type' | 'payload'>> = {},
): OutboxEntry => {
  seq += 1;
  return {
    seq,
    mutationId: `m-${seq}`,
    ...command,
    jobId: 'job-1',
    jobTitle: 'AC repair',
    baseVersion: 2,
    occurredAt: `2026-09-27T09:0${seq % 10}:00.000Z`,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null,
    createdAt: '2026-09-27T09:00:00.000Z',
    ...overrides,
  };
};

const start = () => entry({ type: 'job.start', payload: { location: null } });
const complete = () => entry({ type: 'job.complete', payload: null });

const OPEN_ACTIONS = ['note', 'evidence', 'message'];

describe('projectJob', () => {
  it('shows a pending start as in progress, with the device time', () => {
    const started = start();
    const local = projectJob(serverJob(), [started], WORKER);

    expect(local.status).toBe('IN_PROGRESS');
    expect(local.startedAt).toBe(started.occurredAt);
    expect(local.allowedActions).toEqual(['complete', ...OPEN_ACTIONS]);
  });

  it('applies commands in order: start, then complete', () => {
    const local = projectJob(serverJob(), [start(), complete()], WORKER);
    expect(local.status).toBe('COMPLETED');
    expect(local.allowedActions).toEqual(OPEN_ACTIONS);
  });

  it('adds pending notes once, authored by the worker', () => {
    const note = entry({
      type: 'job.note.add',
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
    const local = projectJob(cancelled, [start(), complete()], WORKER);

    expect(local.status).toBe('CANCELLED');
    expect(local.allowedActions).toEqual(OPEN_ACTIONS);
  });

  it('keeps the server copy untouched', () => {
    const server = serverJob();
    projectJob(server, [start()], WORKER);
    expect(server.status).toBe('ASSIGNED');
  });

  it("shows a pending start's location with the phone's distance estimate", () => {
    const job = serverJob({
      location: { latitude: 28.6139, longitude: 77.209 },
    });
    const withFix = entry({
      type: 'job.start',
      payload: {
        location: {
          latitude: 28.6149,
          longitude: 77.209,
          accuracyMeters: 7,
          capturedAt: '2026-09-27T09:00:00.000Z',
        },
      },
    });

    expect(projectJob(job, [withFix], WORKER).startLocation).toEqual({
      latitude: 28.6149,
      longitude: 77.209,
      accuracyMeters: 7,
      capturedAt: '2026-09-27T09:00:00.000Z',
      distanceMeters: 111,
    });
    // No coordinates on the job: the fix is kept, the distance is unknown.
    expect(
      projectJob(serverJob(), [withFix], WORKER).startLocation?.distanceMeters,
    ).toBeNull();
    // No fix at all (permission denied, no signal): nothing is invented.
    expect(projectJob(job, [start()], WORKER).startLocation).toBeNull();
  });

  it('shows pending photos and messages once, by the worker', () => {
    const photo = entry({
      type: 'job.evidence.add',
      payload: {
        evidenceId: 'evidence-1',
        fileUri: 'file:///data/files/evidence/evidence-1.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 120_000,
        width: 1920,
        height: 1080,
      },
    });
    const message = entry({
      type: 'job.message.send',
      payload: { messageId: 'message-1', body: 'Need a ladder' },
    });
    const local = projectJob(
      serverJob(),
      [photo, photo, message, message],
      WORKER,
    );

    expect(local.evidence).toEqual([
      expect.objectContaining({
        id: 'evidence-1',
        contentType: 'image/jpeg',
        width: 1920,
        uploadedBy: WORKER,
      }),
    ]);
    expect(local.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        body: 'Need a ladder',
        author: WORKER,
      }),
    ]);
  });

  it('does not duplicate a photo the server already has', () => {
    const server = serverJob({
      evidence: [
        {
          id: 'evidence-1',
          contentType: 'image/jpeg',
          sizeBytes: 100,
          width: 10,
          height: 10,
          uploadedBy: WORKER,
          capturedAt: '2026-09-27T09:00:00.000Z',
          createdAt: '2026-09-27T09:05:00.000Z',
        },
      ],
    });
    const photo = entry({
      type: 'job.evidence.add',
      payload: {
        evidenceId: 'evidence-1',
        fileUri: 'file:///x.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100,
        width: 10,
        height: 10,
      },
    });
    expect(projectJob(server, [photo], WORKER).evidence).toHaveLength(1);
  });
});

describe('workerActions', () => {
  it('follows the shared state machine', () => {
    expect(workerActions('ASSIGNED')).toEqual(['start', ...OPEN_ACTIONS]);
    expect(workerActions('IN_PROGRESS')).toEqual(['complete', ...OPEN_ACTIONS]);
    expect(workerActions('COMPLETED')).toEqual(OPEN_ACTIONS);
    expect(workerActions('PENDING')).toEqual(OPEN_ACTIONS);
  });
});
