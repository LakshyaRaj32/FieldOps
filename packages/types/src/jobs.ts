/**
 * Operation contracts shared by the API (which implements them in its DTO classes) and the
 * mobile app (which consumes them). See docs/api.md, "Operations".
 *
 * An operation is a unit of field work: a delivery, a payment collection, a shop visit, an
 * order collection or an inventory check. It is stored and served as a "job" (the resource
 * the API has had since Phase 2), so the offline outbox, evidence, messages, location and
 * notifications work the same for every operation type.
 */

import type { Product } from './commerce';

/**
 * What kind of work an operation is. The type decides the lifecycle (see JobStatus), what
 * the operation refers to (a shop, an order) and what the worker must submit.
 */
export const JobType = {
  /** A general field job with a customer and address (the Phase 2 job). Basic lifecycle. */
  GENERAL: 'GENERAL',
  /** Deliver an order's items to a shop, with proof of delivery. */
  DELIVERY: 'DELIVERY',
  /** Collect a payment from a shop against one of its orders. */
  PAYMENT_COLLECTION: 'PAYMENT_COLLECTION',
  /** Visit a shop and report on a checklist. */
  SHOP_VISIT: 'SHOP_VISIT',
  /** Take a new order at a shop. */
  ORDER_COLLECTION: 'ORDER_COLLECTION',
  /** Count stock of selected products at a shop. */
  INVENTORY_CHECK: 'INVENTORY_CHECK',
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];

/**
 * Lifecycle of an operation. Allowed transitions are defined in one place,
 * packages/shared/src/job-state-machine.ts, which the server enforces and the phone uses
 * offline. Two lifecycles share these statuses.
 *
 * Field lifecycle (every type except GENERAL):
 *
 *   PENDING ─assign─▶ ASSIGNED ─accept─▶ ACCEPTED ─depart─▶ EN_ROUTE ─arrive─▶ ARRIVED
 *      ▲                 │ decline          │ decline                          │ start
 *      └─────────────────┴──────────────────┘                                  ▼
 *   COMPLETED ◀─verify─ SUBMITTED ◀─submit─ IN_PROGRESS ◀──────────────────────┘
 *                          └───reject (rework)───▶ IN_PROGRESS
 *
 *   cancel: any open status before SUBMITTED. fail: from ACCEPTED up to IN_PROGRESS.
 *
 * Basic lifecycle (GENERAL, unchanged since Phase 2):
 *
 *   PENDING ─assign─▶ ASSIGNED ─start─▶ IN_PROGRESS ─complete─▶ COMPLETED   (+ cancel)
 *
 * COMPLETED, CANCELLED and FAILED are terminal: nothing reopens an operation.
 */
export const JobStatus = {
  /** Created, not assigned to anyone (or handed back by the worker it was assigned to). */
  PENDING: 'PENDING',
  /** Assigned to a worker who has not responded yet. */
  ASSIGNED: 'ASSIGNED',
  /** The worker accepted it. */
  ACCEPTED: 'ACCEPTED',
  /** The worker is on the way to the shop. */
  EN_ROUTE: 'EN_ROUTE',
  /** The worker reported arriving at the shop. */
  ARRIVED: 'ARRIVED',
  /** The worker is carrying out the work. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** The worker submitted the result; it waits for a manager's verification. */
  SUBMITTED: 'SUBMITTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  /** The worker could not carry it out (shop closed, owner absent...). */
  FAILED: 'FAILED',
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
  /** The assigned worker accepts the operation (field lifecycle). */
  ACCEPT: 'accept',
  /** The assigned worker hands the operation back, with a reason. */
  DECLINE: 'decline',
  /** The worker sets off for the shop. */
  DEPART: 'depart',
  /** The worker reports arriving at the shop. */
  ARRIVE: 'arrive',
  START: 'start',
  /** Basic lifecycle: the worker finishes the job. */
  COMPLETE: 'complete',
  /** Field lifecycle: the worker submits the result for verification. */
  SUBMIT: 'submit',
  /** The worker reports that the operation cannot be carried out. */
  FAIL: 'fail',
  /** A manager accepts a submitted result. */
  VERIFY: 'verify',
  /** A manager sends a submitted result back for rework, with a reason. */
  REJECT: 'reject',
  /** A manager moves the due time (before the worker sets off). */
  RESCHEDULE: 'reschedule',
  ASSIGN: 'assign',
  EDIT: 'edit',
  CANCEL: 'cancel',
  DELETE: 'delete',
  /** Add a field note (the assigned worker; works offline). */
  NOTE: 'note',
  /** Attach a photo as evidence (the assigned worker; works offline). */
  EVIDENCE: 'evidence',
  /** Post a message on the job (the assigned worker and managers; offline for workers). */
  MESSAGE: 'message',
} as const;

export type JobAction = (typeof JobAction)[keyof typeof JobAction];

/** Entries of a job's append-only history. */
export const JobEventType = {
  CREATED: 'CREATED',
  /** Assigned or reassigned; `assignee` names the worker. */
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  /** The worker handed the operation back (`reason`). */
  DECLINED: 'DECLINED',
  /** The worker set off (EN_ROUTE). */
  DEPARTED: 'DEPARTED',
  ARRIVED: 'ARRIVED',
  STARTED: 'STARTED',
  SUBMITTED: 'SUBMITTED',
  /** A manager accepted the submission; the operation is COMPLETED. */
  VERIFIED: 'VERIFIED',
  /** A manager sent the submission back (`reason`). */
  REJECTED: 'REJECTED',
  /** Basic lifecycle: the worker completed the job. */
  COMPLETED: 'COMPLETED',
  /** The worker could not carry it out (`reason`). */
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  /** The due time moved (`reason` says from when to when). */
  RESCHEDULED: 'RESCHEDULED',
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
  /** The worker's answer, recorded when they submit (null until then). */
  readonly checked: boolean | null;
  readonly responseNote: string | null;
}

/** The shop an operation takes place at (its contact details, for the field). */
export interface JobShop {
  readonly id: string;
  readonly name: string;
  readonly ownerName: string | null;
  readonly phone: string | null;
  readonly address: string;
}

/** The order a delivery or payment collection is for. */
export interface JobOrder {
  readonly id: string;
  readonly orderNumber: string;
}

/**
 * A product line of an operation: the items to deliver (from the order), the products to
 * count (inventory check) or the products ordered (order collection). `quantity` is what the
 * worker reported; null until they submit.
 */
export interface JobLine {
  readonly id: string;
  readonly position: number;
  readonly productId: string;
  /** Copies taken when the line was created, so later catalog edits don't rewrite history. */
  readonly productName: string;
  readonly sku: string;
  /** The quantity to deliver; null where there is no expectation (counts, new orders). */
  readonly expectedQuantity: number | null;
  readonly quantity: number | null;
}

/** A job as shown in lists. */
export interface JobSummary {
  readonly id: string;
  readonly type: JobType;
  readonly title: string;
  readonly customerName: string;
  readonly address: string;
  /** ISO 8601 timestamp: when the work is due. */
  readonly scheduledAt: string;
  readonly priority: JobPriority;
  readonly status: JobStatus;
  readonly assignedWorker: UserSummary | null;
  /** The manager responsible for the operation (sees it, verifies it, is notified). */
  readonly manager: UserSummary;
  /** The shop, for every type except GENERAL. */
  readonly shop: JobShop | null;
  /**
   * PAYMENT_COLLECTION: the amount the manager asked the worker to collect, in the
   * organization currency's minor unit (paise for INR). Set by the manager, never by the
   * worker.
   */
  readonly expectedAmount: number | null;
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
  /** Why (declined, rejected, failed, rescheduled, cancelled), when one was given. */
  readonly reason: string | null;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

/** A note the assigned worker recorded in the field. Append-only. */
export interface JobNote {
  /** Generated by the device, so an offline note keeps its ID forever. */
  readonly id: string;
  readonly body: string;
  readonly author: UserSummary;
  /** Device time when the note was written (informational: device clocks can be wrong). */
  readonly occurredAt: string;
  /** Server time when the note was received (authoritative order). */
  readonly createdAt: string;
}

/**
 * A position fix reported by the worker's phone at a status change. Device data: it can be
 * inaccurate or spoofed, so it is recorded for review, never used to authorize anything
 * (docs/location.md).
 */
export interface DeviceLocation {
  readonly latitude: number;
  readonly longitude: number;
  /** Radius of 68% confidence, in meters, as reported by Android. */
  readonly accuracyMeters: number;
  /** ISO 8601 device time of the fix. */
  readonly capturedAt: string;
}

/** Where a status change was made. */
export interface ActionLocation extends DeviceLocation {
  /**
   * Distance from the job site in meters, computed by the server from the reported fix and
   * the job's coordinates (null when the job has no coordinates). On the device, a pending
   * command shows the phone's own estimate until the server's value arrives.
   */
  readonly distanceMeters: number | null;
}

export const EVIDENCE_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type EvidenceContentType = (typeof EVIDENCE_CONTENT_TYPES)[number];

/** A photo attached to a job. The bytes are fetched separately (authorized download). */
export interface JobEvidence {
  /** Generated by the device, so offline evidence keeps its ID from capture to server. */
  readonly id: string;
  /** Detected by the server from the file's bytes, never taken from the client. */
  readonly contentType: EvidenceContentType;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly uploadedBy: UserSummary;
  /** Device time of capture (informational). */
  readonly capturedAt: string;
  /** Server receipt time. */
  readonly createdAt: string;
}

/** A message on a job between the assigned worker and managers. Append-only. */
export interface JobMessage {
  /** Generated by the sending device, so an offline message keeps its ID. */
  readonly id: string;
  readonly body: string;
  readonly author: UserSummary;
  /** Device time when it was written (informational). */
  readonly occurredAt: string;
  /** Server receipt time (authoritative order). */
  readonly createdAt: string;
}

/** How a payment was made. */
export const PaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  CARD: 'CARD',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * A payment is money the worker reported collecting. It counts towards the order only once a
 * manager verified it; a rejected one never counts.
 */
export const PaymentStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** A payment recorded on an operation (and in the shop's account). */
export interface PaymentRecord {
  /** Generated by the worker's device, so an offline submission keeps its ID. */
  readonly id: string;
  readonly orderId: string;
  readonly jobId: string | null;
  /** Minor units of the organization's currency. */
  readonly amount: number;
  readonly method: PaymentMethod;
  /** Transaction, UPI or cheque reference; required for everything but cash. */
  readonly reference: string | null;
  readonly status: PaymentStatus;
  /** Device time the worker collected it. */
  readonly collectedAt: string;
  readonly recordedBy: UserSummary;
  readonly verifiedBy: UserSummary | null;
  readonly verifiedAt: string | null;
  readonly rejectionReason: string | null;
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
  readonly acceptedAt: string | null;
  readonly arrivedAt: string | null;
  readonly startedAt: string | null;
  readonly submittedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
  /** DELIVERY and PAYMENT_COLLECTION: the order it is for (ORDER_COLLECTION: the order taken). */
  readonly order: JobOrder | null;
  /** Product lines (delivery items, products to count, products ordered). */
  readonly lines: readonly JobLine[];
  /** Payments recorded on this operation (PAYMENT_COLLECTION), oldest first. */
  readonly payments: readonly PaymentRecord[];
  /** Whether at least one photo is needed before the result can be submitted. */
  readonly requiresPhoto: boolean;
  /** The worker's summary of the visit, sent with the submission. */
  readonly submissionNote: string | null;
  /**
   * How far from the shop (meters) a reported position may be before managers see it
   * flagged (the organization's setting). Informational: nothing is blocked by it.
   */
  readonly siteRadiusMeters: number;
  /** Oldest first. */
  readonly history: readonly JobHistoryEntry[];
  /** Worker field notes, in the order the server received them. */
  readonly fieldNotes: readonly JobNote[];
  /** Where the worker was when they reported arriving (null if no fix was available). */
  readonly arrivalLocation: ActionLocation | null;
  /** Where the worker was when they started the job (null if no fix was available). */
  readonly startLocation: ActionLocation | null;
  /** Where the worker was when they completed (basic) or submitted (field) the job. */
  readonly completeLocation: ActionLocation | null;
  /** Photos, in the order the server received them. */
  readonly evidence: readonly JobEvidence[];
  /** The most recent messages (at most 100), oldest first. */
  readonly messages: readonly JobMessage[];
}

/**
 * Everything a worker's device keeps offline: the jobs assigned to them that are open, plus
 * those closed recently. A job missing from the snapshot is no longer the worker's to see.
 */
export interface JobWorkingSet {
  readonly jobs: readonly JobDetail[];
  /**
   * The organization's active products while the worker has an open order collection (so
   * the order can be taken offline); empty otherwise.
   */
  readonly products: readonly Product[];
  /** ISO 8601 server time the snapshot was taken. */
  readonly generatedAt: string;
}

/** A worker's open jobs, for the manager dashboard's workload list. */
export interface WorkerWorkload {
  readonly worker: UserSummary;
  /** Assigned or accepted, not under way yet. */
  readonly assigned: number;
  /** Under way: en route, arrived or in progress. */
  readonly inProgress: number;
}

/** A job history entry across all jobs, for the manager dashboard's activity feed. */
export interface JobActivity extends JobHistoryEntry {
  readonly jobId: string;
  readonly jobTitle: string;
}

/** The team at a glance (dashboard). "Busy" means an operation is under way. */
export interface WorkerFigures {
  /** Active workers in the manager's scope. */
  readonly total: number;
  /** With an operation en route, arrived or in progress. */
  readonly busy: number;
  /** Active and not busy. */
  readonly available: number;
  /** Connected to live updates right now (the app is open and online). */
  readonly online: number;
}

/**
 * Money in the manager's scope, in minor units of the organization's currency. "Today" is
 * the organization's calendar day (in its time zone).
 */
export interface CollectionFigures {
  readonly currency: string;
  /** Unpaid balance of every open order. */
  readonly outstanding: number;
  /** Outstanding on orders due today. */
  readonly dueToday: number;
  /** Outstanding on orders whose due date has passed. */
  readonly overdue: number;
  /** Payments verified today. */
  readonly collectedToday: number;
  /** Collected by workers, waiting for a manager's verification. */
  readonly pendingVerification: number;
}

export interface ShopFigures {
  /** Active shops in scope. */
  readonly total: number;
  /** Shops a worker reported arriving at today. */
  readonly visitedToday: number;
  /** Open shop-visit operations. */
  readonly pendingVisits: number;
}

/**
 * GET /api/v1/jobs/overview (managers and organization admins): the dashboard's figures,
 * computed by the server within the caller's scope. The operation windows are rolling (the
 * last 24 hours / 7 days from `generatedAt`); money and visits use the organization's
 * calendar day.
 */
export interface JobOverview {
  /**
   * `organization`: every operation of the organization (organization admins, managers with
   * organization-wide access); `team`: the manager's own operations, team and shops.
   */
  readonly scope: 'organization' | 'team';
  /** Every job in scope by its current status. */
  readonly statusCounts: Readonly<Record<JobStatus, number>>;
  /** Open jobs whose scheduled time has passed. */
  readonly overdue: number;
  /** Open jobs scheduled within the next 24 hours. */
  readonly dueNext24Hours: number;
  /** Submitted results waiting for verification. */
  readonly awaitingVerification: number;
  /** Jobs completed in the last 7 days. */
  readonly completedLast7Days: number;
  /** Jobs cancelled in the last 7 days. */
  readonly cancelledLast7Days: number;
  /** Jobs that failed in the last 7 days. */
  readonly failedLast7Days: number;
  readonly workers: WorkerFigures;
  readonly collections: CollectionFigures;
  readonly shops: ShopFigures;
  /** Workers with open jobs, busiest first (at most 10). */
  readonly workload: readonly WorkerWorkload[];
  /** The latest history entries in scope, newest first (at most 10). */
  readonly recentActivity: readonly JobActivity[];
  /** ISO 8601 server time the figures were computed. */
  readonly generatedAt: string;
}

/** One page of GET /api/v1/jobs. `nextCursor` is null on the last page. */
export interface JobPage {
  readonly items: readonly JobSummary[];
  readonly nextCursor: string | null;
}

export interface CreateJobRequest {
  /** Defaults to GENERAL. Every other type needs `shopId`. */
  readonly type?: JobType;
  readonly title: string;
  readonly description?: string;
  /** GENERAL only (shop operations take the shop's name). */
  readonly customerName?: string;
  /** GENERAL only (shop operations take the shop's address). */
  readonly address?: string;
  /** GENERAL only (shop operations take the shop's coordinates). */
  readonly location?: GeoPoint;
  readonly shopId?: string;
  /** DELIVERY and PAYMENT_COLLECTION: an open order of the shop. */
  readonly orderId?: string;
  /** PAYMENT_COLLECTION: minor units, at most the order's collectable balance. */
  readonly expectedAmount?: number;
  /** INVENTORY_CHECK: the products to count. */
  readonly productIds?: readonly string[];
  /** Ask for a photo even where the type does not require one. */
  readonly requiresPhoto?: boolean;
  /**
   * The responsible manager. Organization admins may name one; a manager is always
   * responsible for what they create.
   */
  readonly managerId?: string;
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
 * Status is never edited directly: use the action endpoints. The type, shop, order and
 * expected amount never change: cancel the operation and create a new one.
 */
export interface UpdateJobRequest {
  readonly version: number;
  readonly title?: string;
  readonly description?: string | null;
  /** GENERAL only. */
  readonly customerName?: string;
  /** GENERAL only. */
  readonly address?: string;
  /** GENERAL only. */
  readonly location?: GeoPoint | null;
  /** Until assigned; afterwards reschedule, which tells the worker. */
  readonly scheduledAt?: string;
  readonly priority?: JobPriority;
  readonly notes?: string | null;
  /** Replaces the whole checklist. Only before the work starts. */
  readonly checklist?: readonly string[];
}

export interface AssignJobRequest {
  readonly workerId: string;
}

export interface CancelJobRequest {
  readonly reason?: string;
}

/** Body of the worker's status commands (accept, depart, arrive, start, complete). */
export interface JobCommandRequest {
  /** The worker's position at that moment, if the phone could get one. */
  readonly location?: DeviceLocation;
}

/** POST /jobs/:id/decline: the worker hands the operation back. */
export interface DeclineJobRequest {
  readonly reason: string;
}

/** POST /jobs/:id/fail: the worker cannot carry the operation out. */
export interface FailJobRequest extends JobCommandRequest {
  readonly reason: string;
}

/** A checklist item's answer in a submission. */
export interface ChecklistAnswer {
  readonly itemId: string;
  readonly checked: boolean;
  readonly note?: string;
}

/** A counted or delivered quantity for one of the operation's lines. */
export interface LineCount {
  readonly lineId: string;
  readonly quantity: number;
}

/** ORDER_COLLECTION: a product the shop ordered. */
export interface OrderLineInput {
  readonly productId: string;
  readonly quantity: number;
}

/** PAYMENT_COLLECTION: what the worker collected. */
export interface PaymentInput {
  /** A UUID generated by the device: resubmitting the same payment changes nothing. */
  readonly id: string;
  /** Minor units of the organization's currency. */
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly reference?: string;
  /** ISO 8601 device time. */
  readonly collectedAt: string;
}

/**
 * POST /jobs/:id/submit: the worker's result. Which parts are required depends on the
 * operation type (packages/shared/src/operation-requirements.ts: the same rules on the phone
 * and on the server).
 */
export interface SubmitJobRequest extends JobCommandRequest {
  readonly note?: string;
  readonly checklist?: readonly ChecklistAnswer[];
  /** DELIVERY (delivered) and INVENTORY_CHECK (counted): one count per line. */
  readonly lineCounts?: readonly LineCount[];
  /** ORDER_COLLECTION: the products ordered. */
  readonly orderLines?: readonly OrderLineInput[];
  readonly payment?: PaymentInput;
}

/** POST /jobs/:id/verify. */
export interface VerifyJobRequest {
  readonly note?: string;
  /**
   * ORDER_COLLECTION: YYYY-MM-DD when the order taken must be paid (default: 30 days after
   * today in the organization's calendar).
   */
  readonly orderDueDate?: string;
}

/** POST /jobs/:id/reject: back to the worker for rework. */
export interface RejectJobRequest {
  readonly reason: string;
}

/** POST /jobs/:id/reschedule. */
export interface RescheduleJobRequest {
  /** ISO 8601 timestamp. */
  readonly scheduledAt: string;
  readonly reason?: string;
}

/** Multipart fields of POST /jobs/:id/evidence (besides the `file` part). */
export interface AddJobEvidenceFields {
  /** A UUID generated by the device for the new evidence. */
  readonly id: string;
  /** ISO 8601 device time of capture with a time zone. */
  readonly capturedAt: string;
}

export interface SendJobMessageRequest {
  /** A UUID generated by the sending device. */
  readonly id: string;
  readonly body: string;
  /** ISO 8601 device time with a time zone. */
  readonly occurredAt: string;
}

export interface AddJobNoteRequest {
  /** A UUID generated by the device for the new note. */
  readonly id: string;
  readonly body: string;
  /** ISO 8601 device time with a time zone. */
  readonly occurredAt: string;
}
