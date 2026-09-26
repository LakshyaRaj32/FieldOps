/**
 * Job contracts shared by the API (which implements them in its DTO classes) and the mobile
 * app (which consumes them). See docs/api.md, "Jobs".
 */

/**
 * Lifecycle of a job. Allowed transitions are enforced by the server's job state machine
 * (apps/api/src/jobs/domain/job-state-machine.ts):
 *
 *   PENDING ──assign──▶ ASSIGNED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
 *      │                  │  ▲                  │
 *      │                  └──┘ reassign         │
 *      └──────cancel──────┴────────cancel───────┴──▶ CANCELLED
 *
 * COMPLETED and CANCELLED are terminal.
 */
export const JobStatus = {
  /** Created, not assigned to anyone yet. */
  PENDING: 'PENDING',
  /** Assigned to a worker who has not started it. */
  ASSIGNED: 'ASSIGNED',
  /** The assigned worker started it. */
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const JobPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type JobPriority = (typeof JobPriority)[keyof typeof JobPriority];

/**
 * Operations on an existing job. Every job response lists the ones the signed-in user may
 * perform right now (`allowedActions`), computed by the server from the user's role, their
 * relationship to the job and its status. Clients show exactly these and nothing else.
 */
export const JobAction = {
  START: 'start',
  COMPLETE: 'complete',
  ASSIGN: 'assign',
  EDIT: 'edit',
  CANCEL: 'cancel',
  DELETE: 'delete',
} as const;

export type JobAction = (typeof JobAction)[keyof typeof JobAction];

/** Entries of a job's append-only history. */
export const JobEventType = {
  CREATED: 'CREATED',
  /** Assigned or reassigned; `assignee` names the worker. */
  ASSIGNED: 'ASSIGNED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobEventType = (typeof JobEventType)[keyof typeof JobEventType];

/** The minimal public view of a user referenced by a job. */
export interface UserSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** A worker a manager can assign jobs to. */
export interface WorkerSummary extends UserSummary {
  readonly email: string;
}

export interface GeoPoint {
  /** WGS 84 degrees, -90 to 90. */
  readonly latitude: number;
  /** WGS 84 degrees, -180 to 180. */
  readonly longitude: number;
}

export interface JobChecklistItem {
  readonly id: string;
  /** 0-based display order. */
  readonly position: number;
  readonly label: string;
}

/** A job as shown in lists. */
export interface JobSummary {
  readonly id: string;
  readonly title: string;
  readonly customerName: string;
  readonly address: string;
  /** ISO 8601 timestamp. */
  readonly scheduledAt: string;
  readonly priority: JobPriority;
  readonly status: JobStatus;
  readonly assignedWorker: UserSummary | null;
  /** Incremented on every change. Send it back with edits (optimistic concurrency). */
  readonly version: number;
  /** ISO 8601 timestamp. */
  readonly updatedAt: string;
  readonly allowedActions: readonly JobAction[];
}

export interface JobHistoryEntry {
  readonly id: string;
  readonly type: JobEventType;
  readonly fromStatus: JobStatus | null;
  readonly toStatus: JobStatus;
  /** Who did it. */
  readonly actor: UserSummary;
  /** The worker the job was assigned to (ASSIGNED entries only). */
  readonly assignee: UserSummary | null;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** A job with everything the details screen needs. */
export interface JobDetail extends JobSummary {
  readonly description: string | null;
  readonly location: GeoPoint | null;
  /** Instructions from the manager. */
  readonly notes: string | null;
  readonly checklist: readonly JobChecklistItem[];
  readonly cancellationReason: string | null;
  readonly createdBy: UserSummary;
  /** ISO 8601 timestamps. */
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  /** Oldest first. */
  readonly history: readonly JobHistoryEntry[];
}

/** One page of GET /api/v1/jobs. `nextCursor` is null on the last page. */
export interface JobPage {
  readonly items: readonly JobSummary[];
  readonly nextCursor: string | null;
}

export interface CreateJobRequest {
  readonly title: string;
  readonly description?: string;
  readonly customerName: string;
  readonly address: string;
  readonly location?: GeoPoint;
  /** ISO 8601 timestamp. */
  readonly scheduledAt: string;
  /** Defaults to NORMAL. */
  readonly priority?: JobPriority;
  readonly notes?: string;
  /** Item labels, in order. */
  readonly checklist?: readonly string[];
}

/**
 * Partial update of manager-owned fields. `version` must match the job's current version,
 * otherwise the server answers 409 VERSION_CONFLICT. `null` clears an optional field.
 * Status is never edited directly: use the action endpoints.
 */
export interface UpdateJobRequest {
  readonly version: number;
  readonly title?: string;
  readonly description?: string | null;
  readonly customerName?: string;
  readonly address?: string;
  readonly location?: GeoPoint | null;
  readonly scheduledAt?: string;
  readonly priority?: JobPriority;
  readonly notes?: string | null;
  /** Replaces the whole checklist. Only before the job is started. */
  readonly checklist?: readonly string[];
}

export interface AssignJobRequest {
  readonly workerId: string;
}

export interface CancelJobRequest {
  readonly reason?: string;
}
