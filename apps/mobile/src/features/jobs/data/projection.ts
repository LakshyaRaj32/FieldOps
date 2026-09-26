import { nextStatus } from '@fieldops/shared';
import {
  JobAction,
  type JobDetail,
  type JobNote,
  type JobStatus,
  type UserSummary,
} from '@fieldops/types';

import type { OutboxEntry } from './types';

/**
 * The local view of a job: the last server copy with the worker's pending commands applied
 * in order (a local "rebase"). Pure and deterministic.
 *
 * Because the outbox stores commands rather than overwritten rows, a fresh server copy never
 * erases unsynced work: the commands are simply re-applied on top of it. A command the new
 * server state no longer allows (the job was cancelled meanwhile) is not applied: the
 * server state is shown, and the server's verdict on the command arrives with the next push.
 */
export function projectJob(
  server: JobDetail,
  pending: readonly OutboxEntry[],
  me: UserSummary,
): JobDetail {
  let status: JobStatus = server.status;
  let startedAt = server.startedAt;
  let completedAt = server.completedAt;
  const notes: JobNote[] = [...server.fieldNotes];

  for (const entry of pending) {
    switch (entry.type) {
      case 'job.start': {
        const to = nextStatus(status, 'start');
        if (to !== undefined) {
          status = to;
          startedAt = entry.occurredAt;
        }
        break;
      }
      case 'job.complete': {
        const to = nextStatus(status, 'complete');
        if (to !== undefined) {
          status = to;
          completedAt = entry.occurredAt;
        }
        break;
      }
      case 'job.note.add':
        if (
          entry.payload !== null &&
          !notes.some(note => note.id === entry.payload?.noteId)
        ) {
          notes.push({
            id: entry.payload.noteId,
            body: entry.payload.body,
            author: me,
            occurredAt: entry.occurredAt,
            // Not received yet: shown at the device time until the server confirms.
            createdAt: entry.occurredAt,
          });
        }
        break;
    }
  }

  return {
    ...server,
    status,
    startedAt,
    completedAt,
    fieldNotes: notes,
    allowedActions: workerActions(status),
  };
}

/**
 * What the assigned worker can do with a job in `status`, decided on the device with the
 * same state machine the server enforces. Every job on the device is assigned to its user
 * (the working set contains nothing else), so only the status matters here.
 */
export function workerActions(status: JobStatus): JobAction[] {
  return [
    ...(nextStatus(status, 'start') !== undefined ? [JobAction.START] : []),
    ...(nextStatus(status, 'complete') !== undefined
      ? [JobAction.COMPLETE]
      : []),
    JobAction.NOTE,
  ];
}
