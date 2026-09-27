import type {
  JobChangedEvent,
  JobMessageCreatedEvent,
} from '../../events/domain-events.js';
import { Role } from '../../users/role.js';
import { NotificationType } from '../notification-enums.js';

/**
 * Which domain events become notifications, for whom, and with what words. Pure, so the rules
 * are unit-tested (docs/notifications.md, "Notification types").
 *
 * Only events a person must act on or know about notify: an assignment, losing a job, a
 * cancellation, a completion for the manager who created the job, a message from the other
 * side of the job's conversation. Nobody is notified of their own action, and routine
 * changes (a note, a photo, an edit) reach screens through realtime and sync only.
 */

export interface PlannedNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly jobId: string;
  /** Inbox text. The inbox is behind authentication, so it may name the job. */
  readonly title: string;
  readonly body: string;
}

/** Inbox body length limit (the column is VARCHAR(300)). */
const BODY_MAX = 300;

const quoted = (title: string): string => {
  const text = `“${title}”`;
  return text.length <= BODY_MAX ? text : `${text.slice(0, BODY_MAX - 2)}…”`;
};

export const TITLES: Readonly<Record<NotificationType, string>> = {
  JOB_ASSIGNED: 'New job assigned',
  JOB_UNASSIGNED: 'Job reassigned',
  JOB_CANCELLED: 'Job cancelled',
  JOB_COMPLETED: 'Job completed',
  JOB_MESSAGE: 'New message',
};

export function planForJobChange(
  event: JobChangedEvent,
): PlannedNotification[] {
  const plans: PlannedNotification[] = [];
  const add = (userId: string | null, type: NotificationType, body: string) => {
    if (userId !== null && userId !== event.actorId) {
      plans.push({
        userId,
        type,
        jobId: event.jobId,
        title: TITLES[type],
        body,
      });
    }
  };
  const job = quoted(event.jobTitle);

  switch (event.change) {
    case 'assigned':
      add(event.assignedWorkerId, NotificationType.JOB_ASSIGNED, job);
      if (event.previousAssigneeId !== event.assignedWorkerId) {
        add(
          event.previousAssigneeId,
          NotificationType.JOB_UNASSIGNED,
          `${job} is no longer assigned to you.`,
        );
      }
      break;
    case 'cancelled':
      add(event.assignedWorkerId, NotificationType.JOB_CANCELLED, job);
      break;
    case 'completed':
      add(event.createdById, NotificationType.JOB_COMPLETED, job);
      break;
    case 'started':
    case 'updated':
    case 'note':
    case 'evidence':
      break;
  }
  return plans;
}

/**
 * A worker's message goes to the manager who created the job; a manager's (or admin's) to
 * the assigned worker. Never back to the author.
 */
export function planForMessage(
  event: JobMessageCreatedEvent,
): PlannedNotification[] {
  const recipient =
    event.authorRole === Role.WORKER
      ? event.createdById
      : event.assignedWorkerId;
  if (recipient === null || recipient === event.authorId) {
    return [];
  }
  return [
    {
      userId: recipient,
      type: NotificationType.JOB_MESSAGE,
      jobId: event.jobId,
      title: TITLES.JOB_MESSAGE,
      body: quoted(event.jobTitle),
    },
  ];
}

/**
 * What the push itself says. Deliberately generic: push payloads pass through Google's
 * servers and appear on lock screens, so they carry the notification type and IDs only,
 * never a job title, customer or address. The app loads the details after the tap.
 */
export function pushText(type: NotificationType): {
  title: string;
  body: string;
} {
  return { title: TITLES[type], body: 'Open FieldOps to see the details.' };
}
