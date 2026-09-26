import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  type JobHistoryEntry,
  type JobSummary,
  type UserSummary,
} from '@fieldops/types';

import type { BadgeTone, ButtonVariant } from '../../components/ui';

/**
 * How jobs are shown: labels, badge tones, schedule formatting and the command buttons for
 * a job. Pure functions, so the rules are unit-tested without rendering.
 */

export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'Unassigned',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONES: Readonly<Record<JobStatus, BadgeTone>> = {
  PENDING: 'warning',
  ASSIGNED: 'primary',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const PRIORITY_LABELS: Readonly<Record<JobPriority, string>> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Only priorities that deserve attention get a badge in lists. */
export function priorityBadge(
  priority: JobPriority,
): { label: string; tone: BadgeTone } | null {
  switch (priority) {
    case JobPriority.URGENT:
      return { label: 'Urgent', tone: 'danger' };
    case JobPriority.HIGH:
      return { label: 'High priority', tone: 'warning' };
    case JobPriority.NORMAL:
    case JobPriority.LOW:
      return null;
  }
}

/** The two list views: work still to do, and closed jobs. */
export type JobListView = 'active' | 'closed';

export const LIST_VIEWS: Readonly<
  Record<JobListView, { statuses: readonly JobStatus[]; order: 'asc' | 'desc' }>
> = {
  // Next appointment first.
  active: {
    statuses: [JobStatus.PENDING, JobStatus.ASSIGNED, JobStatus.IN_PROGRESS],
    order: 'asc',
  },
  // Most recent first.
  closed: {
    statuses: [JobStatus.COMPLETED, JobStatus.CANCELLED],
    order: 'desc',
  },
};

export const fullName = (user: UserSummary): string =>
  `${user.firstName} ${user.lastName}`;

const pad = (value: number) => String(value).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "10:30 AM" in the device's time zone. */
export function formatTime(date: Date): string {
  const hours = date.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 === 0 ? 12 : hours % 12}:${pad(
    date.getMinutes(),
  )} ${suffix}`;
}

function dayNumber(date: Date): number {
  return Math.round(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
      86_400_000,
  );
}

/**
 * "Today, 10:30 AM", "Tomorrow, 9:00 AM", "Yesterday, 4:15 PM" or "Mon 28 Sep, 10:30 AM"
 * (with the year when it is not the current one).
 */
export function formatSchedule(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  const time = formatTime(date);
  switch (dayNumber(date) - dayNumber(now)) {
    case 0:
      return `Today, ${time}`;
    case 1:
      return `Tomorrow, ${time}`;
    case -1:
      return `Yesterday, ${time}`;
  }
  const year =
    date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${
    MONTHS[date.getMonth()]
  }${year}, ${time}`;
}

/** A button on the job details screen, derived from the server's `allowedActions`. */
export interface JobCommand {
  readonly action: JobAction;
  readonly label: string;
  readonly variant: ButtonVariant;
  /** Asked before running the command (irreversible or destructive). */
  readonly confirm?: {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
  };
}

/**
 * The command buttons to show for a job: exactly the actions the user may perform now, in
 * the server's order (for a worker's job on the device: predicted with the same state
 * machine the server enforces). Nothing the server would reject is offered. Adding a note has
 * its own input, so it is not a button.
 */
export function jobCommands(
  job: Pick<JobSummary, 'allowedActions' | 'assignedWorker'>,
): JobCommand[] {
  return job.allowedActions.flatMap(action => {
    const command = commandFor(action, job.assignedWorker !== null);
    return command === null ? [] : [command];
  });
}

function commandFor(action: JobAction, assigned: boolean): JobCommand | null {
  switch (action) {
    case JobAction.START:
      return { action, label: 'Start job', variant: 'primary' };
    case JobAction.COMPLETE:
      return {
        action,
        label: 'Complete job',
        variant: 'primary',
        confirm: {
          title: 'Complete this job?',
          message: 'The job will be marked as completed. This cannot be undone.',
          confirmLabel: 'Complete',
        },
      };
    case JobAction.ASSIGN:
      return {
        action,
        label: assigned ? 'Reassign worker' : 'Assign worker',
        variant: assigned ? 'secondary' : 'primary',
      };
    case JobAction.EDIT:
      return { action, label: 'Edit details', variant: 'secondary' };
    case JobAction.CANCEL:
      return {
        action,
        label: 'Cancel job',
        variant: 'danger',
        confirm: {
          title: 'Cancel this job?',
          message:
            'The job will be closed and the worker can no longer work on it.',
          confirmLabel: 'Cancel job',
        },
      };
    case JobAction.DELETE:
      return {
        action,
        label: 'Delete job',
        variant: 'danger',
        confirm: {
          title: 'Delete this job?',
          message: 'The job will be removed permanently.',
          confirmLabel: 'Delete',
        },
      };
    case JobAction.NOTE:
      return null;
  }
}

/** One line of job history, for example "Assigned to Asha Verma by Ravi Kumar". */
export function describeHistoryEntry(entry: JobHistoryEntry): string {
  const actor = fullName(entry.actor);
  switch (entry.type) {
    case JobEventType.CREATED:
      return `Created by ${actor}`;
    case JobEventType.ASSIGNED:
      return entry.assignee === null
        ? `Assigned by ${actor}`
        : `Assigned to ${fullName(entry.assignee)} by ${actor}`;
    case JobEventType.STARTED:
      return `Started by ${actor}`;
    case JobEventType.COMPLETED:
      return `Completed by ${actor}`;
    case JobEventType.CANCELLED:
      return `Cancelled by ${actor}`;
  }
}
