import { OPEN_STATUSES } from '@fieldops/shared';
import { formatMoney } from '@fieldops/shared/money';
import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
  PaymentMethod,
  PaymentStatus,
  type ActionLocation,
  type JobHistoryEntry,
  type JobSummary,
  type UserSummary,
} from '@fieldops/types';

import type { BadgeTone, ButtonVariant, IconName } from '../../components/ui';
import { RETRY_POLICY } from './data/retryPolicy';
import type { SyncStatus } from './data/syncEngine';
import type {
  EvidenceUploadState,
  OutboxEntry,
  OutboxType,
} from './data/types';

/**
 * How jobs are shown: labels, badge tones, schedule formatting and the command buttons for
 * a job. Pure functions, so the rules are unit-tested without rendering.
 */

export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'Unassigned',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'On the way',
  ARRIVED: 'At the shop',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Awaiting verification',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export const STATUS_TONES: Readonly<Record<JobStatus, BadgeTone>> = {
  PENDING: 'warning',
  ASSIGNED: 'primary',
  ACCEPTED: 'primary',
  EN_ROUTE: 'info',
  ARRIVED: 'info',
  IN_PROGRESS: 'info',
  SUBMITTED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

export const TYPE_LABELS: Readonly<Record<JobType, string>> = {
  GENERAL: 'Job',
  DELIVERY: 'Delivery',
  PAYMENT_COLLECTION: 'Payment collection',
  SHOP_VISIT: 'Shop visit',
  ORDER_COLLECTION: 'Order collection',
  INVENTORY_CHECK: 'Inventory check',
};

export const TYPE_ICONS: Readonly<Record<JobType, IconName>> = {
  GENERAL: 'construct-outline',
  DELIVERY: 'cube-outline',
  PAYMENT_COLLECTION: 'wallet-outline',
  SHOP_VISIT: 'storefront-outline',
  ORDER_COLLECTION: 'cart-outline',
  INVENTORY_CHECK: 'clipboard-outline',
};

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
};

export const PAYMENT_STATUS_BADGES: Readonly<
  Record<PaymentStatus, { label: string; tone: BadgeTone }>
> = {
  PENDING_VERIFICATION: { label: 'Awaiting verification', tone: 'warning' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

/** An amount in minor units, in the organization's currency ("₹2,00,000"). */
export const money = (minor: number, currency = 'INR'): string =>
  formatMoney(minor, currency);

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
  // Next appointment first; a submitted result is still open (waiting for verification).
  active: { statuses: OPEN_STATUSES, order: 'asc' },
  // Most recent first.
  closed: {
    statuses: [JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.FAILED],
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
  /** The command needs a reason, asked for before it runs (decline, fail, reject). */
  readonly reason?: {
    readonly title: string;
    readonly placeholder: string;
    readonly required: boolean;
  };
}

/**
 * The command buttons to show for a job: exactly the actions the user may perform now, in
 * the server's order (for a worker's job on the device: predicted with the same state
 * machine the server enforces). Nothing the server would reject is offered. Adding a note has
 * its own input, so it is not a button.
 */
export function jobCommands(
  job: Pick<JobSummary, 'allowedActions' | 'assignedWorker'> & {
    readonly type?: JobType;
  },
): JobCommand[] {
  const general = (job.type ?? JobType.GENERAL) === JobType.GENERAL;
  return job.allowedActions.flatMap(action => {
    const command = commandFor(action, job.assignedWorker !== null, general);
    return command === null ? [] : [command];
  });
}

function commandFor(
  action: JobAction,
  assigned: boolean,
  general: boolean,
): JobCommand | null {
  switch (action) {
    case JobAction.ACCEPT:
      return { action, label: 'Accept', variant: 'primary' };
    case JobAction.DEPART:
      return { action, label: "I'm on my way", variant: 'primary' };
    case JobAction.ARRIVE:
      return { action, label: "I've arrived", variant: 'primary' };
    case JobAction.START:
      return {
        action,
        label: general ? 'Start job' : 'Start work',
        variant: 'primary',
      };
    case JobAction.DECLINE:
      return {
        action,
        label: 'Hand back',
        variant: 'secondary',
        reason: {
          title: 'Why are you handing this back?',
          placeholder: 'For example: on leave that day',
          required: true,
        },
      };
    case JobAction.FAIL:
      return {
        action,
        label: "Can't be done",
        variant: 'danger',
        reason: {
          title: 'What stopped you?',
          placeholder: 'For example: the shop was closed',
          required: true,
        },
      };
    case JobAction.VERIFY:
      return {
        action,
        label: 'Verify',
        variant: 'primary',
        confirm: {
          title: 'Verify this result?',
          message:
            'It takes effect now: payments count towards the order, deliveries and new orders are recorded.',
          confirmLabel: 'Verify',
        },
      };
    case JobAction.REJECT:
      return {
        action,
        label: 'Send back',
        variant: 'secondary',
        reason: {
          title: 'What must the worker correct?',
          placeholder: 'For example: the receipt photo is unreadable',
          required: true,
        },
      };
    case JobAction.RESCHEDULE:
      return { action, label: 'Reschedule', variant: 'secondary' };
    case JobAction.SUBMIT:
      // Submitting is the result form's own button (it needs the answers and counts).
      return null;
    case JobAction.COMPLETE:
      return {
        action,
        label: 'Complete job',
        variant: 'primary',
        confirm: {
          title: 'Complete this job?',
          message:
            'The job will be marked as completed. This cannot be undone.',
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
        label: general ? 'Cancel job' : 'Cancel operation',
        variant: 'danger',
        confirm: {
          title: general ? 'Cancel this job?' : 'Cancel this operation?',
          message: 'It will be closed and the worker can no longer work on it.',
          confirmLabel: general ? 'Cancel job' : 'Cancel operation',
        },
      };
    case JobAction.DELETE:
      return {
        action,
        label: general ? 'Delete job' : 'Delete operation',
        variant: 'danger',
        confirm: {
          title: general ? 'Delete this job?' : 'Delete this operation?',
          message: 'It will be removed permanently.',
          confirmLabel: 'Delete',
        },
      };
    case JobAction.NOTE:
    case JobAction.EVIDENCE:
    case JobAction.MESSAGE:
      // These have their own composers, not buttons.
      return null;
  }
}

/** One line of job history, for example "Assigned to Asha Verma by Ravi Kumar". */
export function describeHistoryEntry(entry: JobHistoryEntry): string {
  const actor = fullName(entry.actor);
  const why = entry.reason === null ? '' : `: ${entry.reason}`;
  switch (entry.type) {
    case JobEventType.CREATED:
      return `Created by ${actor}`;
    case JobEventType.ASSIGNED:
      return entry.assignee === null
        ? `Assigned by ${actor}`
        : `Assigned to ${fullName(entry.assignee)} by ${actor}`;
    case JobEventType.ACCEPTED:
      return `Accepted by ${actor}`;
    case JobEventType.DECLINED:
      return `Handed back by ${actor}${why}`;
    case JobEventType.DEPARTED:
      return `${actor} set off`;
    case JobEventType.ARRIVED:
      return `${actor} arrived`;
    case JobEventType.STARTED:
      return `Started by ${actor}`;
    case JobEventType.SUBMITTED:
      return `Submitted by ${actor}`;
    case JobEventType.VERIFIED:
      return `Verified by ${actor}${why}`;
    case JobEventType.REJECTED:
      return `Sent back by ${actor}${why}`;
    case JobEventType.COMPLETED:
      return `Completed by ${actor}`;
    case JobEventType.FAILED:
      return `Could not be done (${actor})${why}`;
    case JobEventType.CANCELLED:
      return `Cancelled by ${actor}${why}`;
    case JobEventType.RESCHEDULED:
      return `Rescheduled by ${actor}${why}`;
  }
}

/** How the worker's offline commands are named in the UI. */
export const OUTBOX_LABELS: Readonly<Record<OutboxType, string>> = {
  'job.accept': 'Accept',
  'job.decline': 'Hand back',
  'job.depart': 'On my way',
  'job.arrive': 'Arrived',
  'job.start': 'Start job',
  'job.complete': 'Complete job',
  'job.submit': 'Submit result',
  'job.fail': "Can't be done",
  'job.note.add': 'Note',
  'job.evidence.add': 'Photo',
  'job.message.send': 'Message',
};

/** "35 m", "1.2 km", "18 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * Whether a reported position is farther from the site than the organization's radius
 * (a hint for the manager; nothing is blocked by it, GPS can be wrong).
 */
export function isOutsideSite(
  location: ActionLocation,
  radiusMeters: number,
): boolean {
  return (
    location.distanceMeters !== null && location.distanceMeters > radiusMeters
  );
}

/**
 * Where a job was started or completed, for example "120 m from the site (±15 m)". The
 * accuracy is shown because a phone fix indoors can be off by more than the distance.
 */
export function describeActionLocation(location: ActionLocation): string {
  const accuracy = `±${formatDistance(location.accuracyMeters)}`;
  if (location.distanceMeters === null) {
    return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(
      5,
    )} (${accuracy})`;
  }
  return `${formatDistance(
    location.distanceMeters,
  )} from the site (${accuracy})`;
}

export const EVIDENCE_STATE_LABELS: Readonly<
  Record<EvidenceUploadState, { label: string; tone: BadgeTone }>
> = {
  pending: { label: 'Waiting to upload', tone: 'neutral' },
  uploading: { label: 'Uploading…', tone: 'primary' },
  uploaded: { label: 'Uploaded', tone: 'success' },
  failed: { label: 'Upload failed', tone: 'danger' },
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Why a command did not reach the server, in words a worker can act on. Conflicts mean the
 * server state won; failures mean the command was refused or could not be delivered.
 */
export function describeProblem(entry: OutboxEntry): string {
  const what = `“${OUTBOX_LABELS[entry.type]}” on ${entry.jobTitle}`;
  const code = entry.lastError?.code;
  if (entry.status === 'conflict') {
    if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
      return `${what} was not applied: this job is no longer assigned to you.`;
    }
    return `${what} was not applied: the job changed while you were offline. The latest version is shown.`;
  }
  if (entry.attempts >= RETRY_POLICY.maxAttempts) {
    return `${what} could not be delivered after ${entry.attempts} attempts. Try again when the server is reachable.`;
  }
  return `${what} was refused by the server${
    code === undefined ? '' : ` (${code})`
  }.`;
}

/** The badge on a worker's job: problems first, then unsynced changes. */
export function jobSyncBadge(item: {
  readonly pendingChanges: number;
  readonly problems: number;
}): { label: string; tone: BadgeTone } | null {
  if (item.problems > 0) {
    return { label: 'Needs attention', tone: 'danger' };
  }
  if (item.pendingChanges > 0) {
    return { label: 'Waiting to sync', tone: 'neutral' };
  }
  return null;
}

export interface SyncBanner {
  readonly message: string;
  readonly tone: BadgeTone;
}

/** The global sync message, or null when everything is synced (nothing to say). */
export function describeSync(status: SyncStatus | null): SyncBanner | null {
  if (status === null) {
    return null;
  }
  const problems = status.failed + status.conflicts;
  if (problems > 0) {
    return {
      message: `${plural(
        problems,
        'change needs',
        'changes need',
      )} attention (Profile › Sync).`,
      tone: 'danger',
    };
  }
  if (status.pending === 0) {
    return null;
  }
  const changes = plural(status.pending, 'change', 'changes');
  if (status.phase === 'syncing') {
    return { message: `Syncing ${changes}…`, tone: 'primary' };
  }
  if (status.phase === 'offline') {
    return {
      message: `${changes} saved on this phone. They will sync when you are back online.`,
      tone: 'warning',
    };
  }
  return { message: `${changes} waiting to sync.`, tone: 'neutral' };
}
