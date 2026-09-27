import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  decideTransition,
  isChecklistEditable,
  isDeletable,
  isEditable,
  OPEN_STATUSES,
  type JobTransition,
} from '@fieldops/shared';
import { formatMoney } from '@fieldops/shared/money';
import { submissionProblems } from '@fieldops/shared/requirements';

import { AccessService } from '../access/access.service.js';
import { writeAudit, type AuditRecord } from '../audit/audit.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppException, AuthErrors } from '../common/errors/app-exception.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import {
  calendarDate,
  dateOnly,
  startOfDay,
  toAmount,
} from '../common/money.js';
import { orgScope, type OrgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { DomainEvents, type JobChangeKind } from '../events/domain-events.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ProcessedMutation } from '../generated/prisma/client.js';
import { PresenceService } from '../realtime/presence.service.js';
import {
  createOrder,
  LedgerErrors,
  normalizeReference,
  recordDelivery,
  recordPendingPayment,
  rejectPayment,
  verifyPayment,
} from '../shops/ledger.js';
import { OrdersService } from '../shops/orders.service.js';
import { ShopsService } from '../shops/shops.service.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { Role } from '../users/role.js';
import { UsersService } from '../users/users.service.js';
import { decodeJobCursor, encodeJobCursor } from './data/job-cursor.js';
import {
  ChildIdTakenError,
  DuplicateMutationError,
  EvidenceLimitError,
  JobsRepository,
  NoteIdTakenError,
  type EventLocationInput,
  type JobDetailRecord,
  type JobEventInput,
  type JobFieldChanges,
  type JobLineInput,
  type JobOperation,
  type MutationRecord,
  type TransitionWork,
  type Tx,
} from './data/jobs.repository.js';
import { inspectImage } from './domain/evidence-image.js';
import { eventLocation } from './domain/job-location.js';
import {
  canView,
  hasPermission,
  isPermitted,
  type JobPermission,
} from './domain/job.policy.js';
import type {
  AddJobEvidenceDto,
  AddJobNoteDto,
  RescheduleJobDto,
  SendJobMessageDto,
  SubmitJobDto,
  VerifyJobDto,
} from './dto/job-command.dto.js';
import type { DeviceLocationDto } from './dto/job-fields.js';
import type { CreateJobDto } from './dto/create-job.dto.js';
import type { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { JobOverviewDto } from './dto/job-overview.dto.js';
import {
  JobDetailDto,
  JobPageDto,
  JobSummaryDto,
  JobWorkingSetDto,
} from './dto/job-response.dto.js';
import type { UpdateJobDto } from './dto/update-job.dto.js';
import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
  JobType,
} from './job-enums.js';
import { JobErrors } from './job.errors.js';

const DEFAULT_PAGE_SIZE = 20;

/** Closed jobs stay in a worker's offline working set this long after their last change. */
const WORKING_SET_CLOSED_DAYS = 7;
/** Upper bound on the working set (far above a worker's realistic open jobs). */
const WORKING_SET_LIMIT = 200;
/** Payment terms of an order taken in the field, unless the verifier sets a due date. */
const ORDER_COLLECTION_TERMS_DAYS = 30;

/** Past participles for "A job that is completed can't be started." */
const TRANSITION_VERBS: Readonly<Record<JobTransition, string>> = {
  assign: 'assigned',
  accept: 'accepted',
  decline: 'declined',
  depart: 'started on',
  arrive: 'marked as arrived',
  start: 'started',
  complete: 'completed',
  submit: 'submitted',
  verify: 'verified',
  reject: 'sent back',
  fail: 'marked as failed',
  cancel: 'cancelled',
  reschedule: 'rescheduled',
};

/** What a transition is called in job.changed events. */
const TRANSITION_CHANGES: Readonly<Record<JobTransition, JobChangeKind>> = {
  assign: 'assigned',
  accept: 'accepted',
  decline: 'declined',
  depart: 'departed',
  arrive: 'arrived',
  start: 'started',
  complete: 'completed',
  submit: 'submitted',
  verify: 'verified',
  reject: 'rejected',
  fail: 'failed',
  cancel: 'cancelled',
  reschedule: 'rescheduled',
};

/** The action gate of each transition (also the permission it needs). */
const TRANSITION_ACTIONS: Readonly<Record<JobTransition, JobAction>> = {
  assign: JobAction.ASSIGN,
  accept: JobAction.ACCEPT,
  decline: JobAction.DECLINE,
  depart: JobAction.DEPART,
  arrive: JobAction.ARRIVE,
  start: JobAction.START,
  complete: JobAction.COMPLETE,
  submit: JobAction.SUBMIT,
  verify: JobAction.VERIFY,
  reject: JobAction.REJECT,
  fail: JobAction.FAIL,
  cancel: JobAction.CANCEL,
  reschedule: JobAction.RESCHEDULE,
};

/** Per transition: the history entry, the fields that change besides status, extra work. */
interface TransitionPlan {
  readonly eventType: JobEventType;
  readonly fields: JobFieldChanges;
  readonly assigneeId?: string;
  readonly reason?: string;
  /** Where the worker was (worker status changes, when the phone sent a fix). */
  readonly location?: EventLocationInput;
  /** Ledger writes, answers, audit: in the same transaction as the status change. */
  readonly work?: TransitionWork;
}

/** Largest accepted evidence file (the app resizes photos to about 1920 px first). */
export const EVIDENCE_MAX_BYTES = 10 * 1_048_576;
/** Photos per job: generous for field work, and a bound on storage abuse. */
export const EVIDENCE_PER_JOB = 50;

/** A file from a multipart upload (the parts of multer's file object this module uses). */
export interface UploadedEvidenceFile {
  readonly buffer: Buffer;
  readonly size: number;
}

/** An evidence file ready to be sent to the client. */
export interface EvidenceContent {
  readonly data: Buffer;
  readonly contentType: string;
  readonly fileName: string;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`;

/**
 * Operation use cases. Every operation follows the same order, so failures are consistent:
 *
 * 1. the caller's organization (never the client's) and the job; if the caller may not see
 *    it → 404 (existence is not revealed, across organizations or teams)
 * 2. the caller's permission and relationship to the job → 403
 * 3. what the job's status (and type) allows → 409
 * 4. the business rules of the step (requirements, balances, references) → 422 / 409
 * 5. one transaction: compare-and-set on `version`, the history event, the idempotency
 *    record and the ledger's writes → 409 on a race
 *
 * Authorization comes from domain/job.policy.ts, status rules from @fieldops/shared (the
 * state machine), submission rules from @fieldops/shared/requirements and money rules from
 * the shops module's ledger; this class orchestrates.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly users: UsersService,
    private readonly shops: ShopsService,
    private readonly orders: OrdersService,
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
    private readonly presence: PresenceService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---- Creating and reading -------------------------------------------------------

  async create(
    user: AuthenticatedUser,
    dto: CreateJobDto,
  ): Promise<JobDetailDto> {
    this.assertPermission(user, 'job:create');
    const scope = orgScope(user);
    const type = dto.type ?? JobType.GENERAL;
    const managerId = await this.responsibleManager(scope, dto.managerId);
    const place = await this.placeFor(scope, type, dto);

    const job = await this.jobs.create(
      {
        organizationId: scope.organizationId,
        type,
        title: dto.title,
        description: dto.description ?? null,
        ...place.fields,
        scheduledAt: new Date(dto.scheduledAt),
        priority: dto.priority ?? JobPriority.NORMAL,
        notes: dto.notes ?? null,
        requiresPhoto: dto.requiresPhoto ?? false,
        managerId,
        createdById: user.userId,
      },
      dto.checklist ?? [],
      place.lines,
      {
        type: JobEventType.CREATED,
        fromStatus: null,
        toStatus: JobStatus.PENDING,
        actorId: user.userId,
      },
      (tx, jobId) =>
        writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: user.userId,
          action: 'operation.created',
          entityType: 'operation',
          entityId: jobId,
          summary: `${type} “${dto.title}” created`,
          data: {
            type,
            shopId: place.fields.shopId,
            orderId: place.fields.orderId,
            expectedAmount:
              place.fields.expectedAmount === null
                ? null
                : Number(place.fields.expectedAmount),
          },
        }),
    );
    return JobDetailDto.from(job, user);
  }

  /**
   * Staff see the operations in their scope (organization-wide, or the ones they are
   * responsible for); workers always get exactly their own: the filter is forced
   * server-side, and asking for another worker's operations is refused, not ignored.
   */
  async list(
    user: AuthenticatedUser,
    query: ListJobsQueryDto,
  ): Promise<JobPageDto> {
    const scope = orgScope(user);
    let assignedWorkerId = query.assignedWorkerId;
    let managerId: string | undefined;
    if (hasPermission(user.role, 'job:read:all')) {
      managerId = scope.organizationWide ? undefined : user.userId;
    } else {
      this.assertPermission(user, 'job:read:assigned');
      if (assignedWorkerId !== undefined && assignedWorkerId !== user.userId) {
        throw AuthErrors.forbidden();
      }
      assignedWorkerId = user.userId;
    }

    const cursor =
      query.cursor === undefined ? undefined : decodeJobCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Some fields are missing or invalid.',
        [{ field: 'cursor', message: 'Cursor is invalid.' }],
      );
    }

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { items, hasMore } = await this.jobs.list({
      organizationId: scope.organizationId,
      ...(managerId !== undefined && { managerId }),
      order: query.order ?? 'asc',
      limit,
      ...(query.status !== undefined && { statuses: query.status }),
      ...(query.type !== undefined && { types: query.type }),
      ...(query.shopId !== undefined && { shopId: query.shopId }),
      ...(assignedWorkerId !== undefined && { assignedWorkerId }),
      ...(cursor !== undefined && { cursor }),
    });
    const last = items.at(-1);
    return Object.assign(new JobPageDto(), {
      items: items.map(job => JobSummaryDto.from(job, user)),
      nextCursor:
        hasMore && last !== undefined
          ? encodeJobCursor({ scheduledAt: last.scheduledAt, id: last.id })
          : null,
    });
  }

  /**
   * The manager dashboard, from real data only, within the caller's scope: operations by
   * status and time, the team's availability, money (outstanding, due, overdue, collected
   * today) and shop coverage. Computed on request.
   */
  async overview(user: AuthenticatedUser): Promise<JobOverviewDto> {
    this.assertPermission(user, 'job:read:all');
    const scope = orgScope(user);
    const now = new Date();
    const jobScope = {
      organizationId: scope.organizationId,
      ...(!scope.organizationWide && { managerId: scope.userId }),
    };
    const [record, workerFilter, shopFilter, settings] = await Promise.all([
      this.jobs.overview(jobScope, now),
      this.access.workerFilter(scope),
      this.access.shopFilter(scope),
      this.orders.money(scope.organizationId),
    ]);
    const workers = await this.users.listActiveWorkers(
      scope.organizationId,
      workerFilter,
      10_000,
    );
    const workerIds = workers.map(worker => worker.id);
    const busy =
      workerIds.length === 0
        ? []
        : await this.jobs.busyWorkerIds(scope.organizationId, workerIds);
    const dayStart = startOfDay(
      calendarDate(now, settings.timeZone),
      settings.timeZone,
    );
    const [collections, shopTotal, shopActivity] = await Promise.all([
      this.orders.collectionFigures(scope.organizationId, shopFilter, now),
      this.shops.countActive(scope.organizationId, shopFilter),
      this.jobs.shopActivity(jobScope, shopFilter, dayStart),
    ]);
    return JobOverviewDto.from(
      record,
      {
        scope: scope.organizationWide ? 'organization' : 'team',
        workers: {
          total: workerIds.length,
          busy: busy.length,
          available: workerIds.length - busy.length,
          online: this.presence.countOnline(workerIds),
        },
        collections,
        shops: { total: shopTotal, ...shopActivity },
      },
      now,
    );
  }

  /**
   * Everything the worker's device keeps offline, as one snapshot. The device replaces its
   * copy with it, so a job that disappears here (reassigned, declined, or closed long ago)
   * leaves the device once its pending changes have been resolved. The catalog comes along
   * while the worker has an order to take, so it can be taken offline.
   */
  async workingSet(user: AuthenticatedUser): Promise<JobWorkingSetDto> {
    this.assertPermission(user, 'job:read:assigned');
    const scope = orgScope(user);
    const generatedAt = new Date();
    const closedSince = new Date(
      generatedAt.getTime() - WORKING_SET_CLOSED_DAYS * 86_400_000,
    );
    const jobs = await this.jobs.workingSet(
      user.userId,
      closedSince,
      WORKING_SET_LIMIT,
    );
    const takesOrders = jobs.some(
      job =>
        job.type === JobType.ORDER_COLLECTION &&
        OPEN_STATUSES.includes(job.status),
    );
    return Object.assign(new JobWorkingSetDto(), {
      jobs: jobs.map(job => JobDetailDto.from(job, user)),
      products: takesOrders
        ? await this.catalog.activeProducts(scope.organizationId)
        : [],
      generatedAt: generatedAt.toISOString(),
    });
  }

  async get(user: AuthenticatedUser, id: string): Promise<JobDetailDto> {
    return JobDetailDto.from(await this.loadVisible(user, id), user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateJobDto,
  ): Promise<JobDetailDto> {
    const job = await this.loadVisible(user, id);
    this.assertPermitted(user, job, JobAction.EDIT);
    if (!isEditable(job.status)) {
      throw JobErrors.notEditable(
        job.status === JobStatus.SUBMITTED
          ? "A submitted operation can't be changed while it waits for verification."
          : "Completed, cancelled and failed operations can't be changed.",
      );
    }
    // Field rules first: they hold whatever version the client read.
    if (job.type !== JobType.GENERAL) {
      for (const field of ['customerName', 'address', 'location'] as const) {
        if (dto[field] !== undefined) {
          throw BusinessErrors.invalid(
            field,
            "A shop operation takes the shop's details; edit the shop instead.",
          );
        }
      }
      if (dto.scheduledAt !== undefined && job.status !== JobStatus.PENDING) {
        throw BusinessErrors.invalid(
          'scheduledAt',
          'Reschedule the operation, so the worker is told about the new time.',
        );
      }
    }

    if (dto.version !== job.version) {
      throw JobErrors.versionConflict();
    }
    if (dto.checklist !== undefined && !isChecklistEditable(job.status)) {
      throw JobErrors.notEditable(
        "The checklist can't be changed after the worker has accepted the operation.",
      );
    }
    const fields = fieldChanges(dto);
    if (Object.keys(fields).length === 0 && dto.checklist === undefined) {
      return JobDetailDto.from(job, user);
    }
    const updated = await this.jobs.update(id, job.version, {
      fields,
      ...(dto.checklist !== undefined && { checklist: dto.checklist }),
    });
    if (updated === null) {
      throw JobErrors.versionConflict();
    }
    this.publishChange(updated, 'updated', user.userId);
    return JobDetailDto.from(updated, user);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const job = await this.loadVisible(user, id);
    this.assertPermitted(user, job, JobAction.DELETE);
    if (!isDeletable(job.status)) {
      throw JobErrors.notEditable(
        'Only pending operations can be deleted. Cancel it instead.',
      );
    }
    if (!(await this.jobs.deletePending(id, job.version))) {
      throw JobErrors.versionConflict();
    }
  }

  // ---- Manager actions -------------------------------------------------------------

  /**
   * Assigns (or reassigns) the operation to an active worker of the same organization; a
   * manager without organization-wide access may pick only their own team.
   */
  assign(
    user: AuthenticatedUser,
    id: string,
    workerId: string,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'assign', {
      sameAssignee: job => job.assignedWorkerId === workerId,
      prepare: async job => {
        const worker = await this.users.findById(workerId);
        if (
          worker === null ||
          !worker.isActive ||
          worker.role !== Role.WORKER ||
          worker.organizationId !== job.organizationId
        ) {
          throw JobErrors.invalidAssignee();
        }
        const scope = orgScope(user);
        if (
          !scope.organizationWide &&
          !(await this.access.isInTeam(user.userId, workerId))
        ) {
          throw BusinessErrors.invalidReference(
            'workerId',
            'You can assign only workers of your own team.',
          );
        }
        return {
          eventType: JobEventType.ASSIGNED,
          // A new assignee has not accepted anything yet.
          fields: { assignedWorkerId: workerId, acceptedAt: null },
          assigneeId: workerId,
        };
      },
    });
  }

  reschedule(
    user: AuthenticatedUser,
    id: string,
    dto: RescheduleJobDto,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'reschedule', {
      prepare: async job => ({
        eventType: JobEventType.RESCHEDULED,
        fields: {
          scheduledAt: new Date(dto.scheduledAt),
          // An accepted operation goes back to ASSIGNED: the worker confirms the new time.
          ...(job.status === JobStatus.ACCEPTED && { acceptedAt: null }),
        },
        ...(dto.reason !== undefined && { reason: dto.reason }),
      }),
    });
  }

  cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string | undefined,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'cancel', {
      prepare: async job => ({
        eventType: JobEventType.CANCELLED,
        fields: { cancelledAt: new Date(), cancellationReason: reason ?? null },
        ...(reason !== undefined && { reason }),
        work: tx =>
          writeAudit(tx, {
            organizationId: job.organizationId,
            actorId: user.userId,
            action: 'operation.cancelled',
            entityType: 'operation',
            entityId: job.id,
            summary: `“${job.title}” cancelled`,
            data: { reason: reason ?? null },
          }),
      }),
    });
  }

  /**
   * A manager accepts a submitted result. Only now does it take effect: a collection's
   * payment counts towards the order, a delivery raises the delivered quantities, an order
   * collection becomes an order. All in the transaction of the status change.
   */
  verify(
    user: AuthenticatedUser,
    id: string,
    dto: VerifyJobDto,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'verify', {
      prepare: async job => {
        const settings = await this.orders.money(job.organizationId);
        const now = new Date();
        const today = calendarDate(now, settings.timeZone);
        let dueDate: string | undefined;
        if (job.type === JobType.ORDER_COLLECTION) {
          dueDate =
            dto.orderDueDate ??
            calendarDate(
              new Date(
                now.getTime() + ORDER_COLLECTION_TERMS_DAYS * 86_400_000,
              ),
              settings.timeZone,
            );
          if (dueDate < today) {
            throw BusinessErrors.invalid(
              'orderDueDate',
              "The due date can't be in the past.",
            );
          }
        }
        return {
          eventType: JobEventType.VERIFIED,
          fields: { completedAt: now },
          ...(dto.note !== undefined && { reason: dto.note }),
          work: tx =>
            this.applyVerification(tx, job, user, {
              now,
              today,
              dueDate,
              currency: settings.currency,
            }),
        };
      },
    });
  }

  /** A manager sends a submitted result back for rework; a pending payment is rejected. */
  reject(
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'reject', {
      prepare: async job => ({
        eventType: JobEventType.REJECTED,
        fields: {},
        reason,
        work: async tx => {
          const pending = await tx.payment.findMany({
            where: { jobId: job.id, status: 'PENDING_VERIFICATION' },
          });
          const settings = await tx.organization.findUniqueOrThrow({
            where: { id: job.organizationId },
            select: { currency: true },
          });
          for (const payment of pending) {
            await rejectPayment(
              tx,
              payment.id,
              user.userId,
              reason,
              new Date(),
            );
            await writeAudit(tx, {
              organizationId: job.organizationId,
              actorId: user.userId,
              action: 'payment.rejected',
              entityType: 'payment',
              entityId: payment.id,
              summary: `Payment of ${formatMoney(toAmount(payment.amount), settings.currency)} rejected`,
              data: { jobId: job.id, orderId: payment.orderId, reason },
            });
          }
        },
      }),
    });
  }

  // ---- Worker actions (offline commands, idempotent) ------------------------------

  /** Acceptance can happen anywhere, so no location is recorded with it. */
  accept(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'accept',
      'job.accept',
      idempotencyKey,
      () => ({
        eventType: JobEventType.ACCEPTED,
        fields: { acceptedAt: new Date() },
      }),
    );
  }

  decline(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'decline',
      'job.decline',
      idempotencyKey,
      () => ({
        eventType: JobEventType.DECLINED,
        fields: { assignedWorkerId: null, acceptedAt: null },
        reason,
      }),
    );
  }

  depart(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'depart',
      'job.depart',
      idempotencyKey,
      job => ({
        eventType: JobEventType.DEPARTED,
        fields: {},
        ...withLocation(job, location),
      }),
    );
  }

  arrive(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'arrive',
      'job.arrive',
      idempotencyKey,
      job => ({
        eventType: JobEventType.ARRIVED,
        fields: { arrivedAt: new Date() },
        ...withLocation(job, location),
      }),
    );
  }

  /**
   * The assigned worker starts the job, optionally reporting where they are. Retries with the
   * same idempotency key are replays.
   */
  start(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'start',
      'job.start',
      idempotencyKey,
      job => ({
        eventType: JobEventType.STARTED,
        fields: { startedAt: new Date() },
        ...withLocation(job, location),
      }),
    );
  }

  /** Basic lifecycle: the assigned worker completes the job. */
  complete(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'complete',
      'job.complete',
      idempotencyKey,
      job => ({
        eventType: JobEventType.COMPLETED,
        fields: { completedAt: new Date() },
        ...withLocation(job, location),
      }),
    );
  }

  fail(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.workerStep(
      user,
      id,
      'fail',
      'job.fail',
      idempotencyKey,
      job => ({
        eventType: JobEventType.FAILED,
        fields: { failedAt: new Date(), failureReason: reason },
        reason,
        ...withLocation(job, location),
      }),
    );
  }

  /**
   * The worker submits the result. The requirements of the type (photos, answers, counts,
   * the payment) are checked with the same rules the phone applied offline; the server then
   * checks what only it can know (the order's balance, the payment reference, the catalog).
   * Answers, counts and the payment are recorded in the transaction of the status change.
   */
  async submit(
    user: AuthenticatedUser,
    id: string,
    dto: SubmitJobDto,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    try {
      return await this.workerStep(
        user,
        id,
        'submit',
        'job.submit',
        idempotencyKey,
        async job => this.submissionPlan(user, job, dto),
      );
    } catch (error) {
      if (!isUniqueViolation(error) || dto.payment === undefined) {
        throw error;
      }
      // A concurrent identical submission recorded the payment first, or another payment
      // already has this reference.
      const existing = await this.jobs.findPayment(
        dto.payment.id.toLowerCase(),
      );
      if (existing === null) {
        throw LedgerErrors.duplicateReference();
      }
      if (existing.jobId === id && existing.recordedById === user.userId) {
        return JobDetailDto.from(await this.loadVisible(user, id), user);
      }
      throw JobErrors.idempotencyKeyReused();
    }
  }

  // ---- Child collections (notes, photos, messages) --------------------------------

  /**
   * The assigned worker adds a field note, on a job in any status. Notes are append-only, so
   * they never conflict. The note ID comes from the device and makes the command idempotent
   * even without an idempotency key.
   */
  addNote(
    user: AuthenticatedUser,
    id: string,
    dto: AddJobNoteDto,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    return this.idempotent(
      user,
      idempotencyKey,
      'job.note.add',
      id,
      201,
      async mutation => {
        const job = await this.loadVisible(user, id);
        this.assertPermitted(user, job, JobAction.NOTE);
        try {
          const updated = await this.jobs.addNote(
            id,
            {
              id: dto.id,
              authorId: user.userId,
              body: dto.body,
              occurredAt: new Date(dto.occurredAt),
            },
            mutation,
          );
          this.publishChange(updated, 'note', user.userId);
          return JobDetailDto.from(updated, user);
        } catch (error) {
          if (!(error instanceof NoteIdTakenError)) {
            throw error;
          }
          // The same note sent again: nothing to do. Another note's ID: refuse.
          const existing = await this.jobs.findNote(dto.id);
          if (existing?.jobId === id && existing.authorId === user.userId) {
            return JobDetailDto.from(await this.loadVisible(user, id), user);
          }
          throw JobErrors.idempotencyKeyReused();
        }
      },
    );
  }

  /**
   * The assigned worker attaches a photo (proof of delivery, a receipt, a shop picture), on
   * a job in any status. The file is checked from its bytes (JPEG or PNG only, bounded
   * dimensions), stripped of metadata, stored in object storage, and only then recorded. The
   * evidence ID comes from the device: uploading the same evidence again is a replay, and
   * the same photo uploaded again under a new ID is not stored twice.
   *
   * Storage and database cannot share a transaction: the object is written first, and removed
   * again if the metadata could not be recorded, so a failed upload leaves nothing behind
   * (except after a process crash between the two, see docs/evidence.md).
   */
  addEvidence(
    user: AuthenticatedUser,
    id: string,
    dto: AddJobEvidenceDto,
    file: UploadedEvidenceFile | undefined,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    return this.idempotent(
      user,
      idempotencyKey,
      'job.evidence.add',
      id,
      201,
      async mutation => {
        const job = await this.loadVisible(user, id);
        this.assertPermitted(user, job, JobAction.EVIDENCE);
        const evidenceId = dto.id.toLowerCase();

        const existing = await this.jobs.findEvidence(evidenceId);
        if (existing !== null) {
          if (existing.jobId === id && existing.uploadedById === user.userId) {
            return JobDetailDto.from(job, user);
          }
          throw JobErrors.idempotencyKeyReused();
        }

        if (file === undefined) {
          throw JobErrors.fileMissing();
        }
        if (file.size > EVIDENCE_MAX_BYTES) {
          throw JobErrors.fileTooLarge(EVIDENCE_MAX_BYTES);
        }
        const inspection = inspectImage(file.buffer);
        if (!inspection.ok) {
          throw JobErrors.unsupportedFile(inspection.reason);
        }
        const { image } = inspection;
        const sha256 = createHash('sha256').update(image.data).digest('hex');
        if ((await this.jobs.countEvidenceWithHash(id, sha256)) > 0) {
          // Exactly this photo is already attached (picked twice): keep one copy.
          return JobDetailDto.from(job, user);
        }
        const storageKey = `evidence/${id}/${evidenceId}.${image.extension}`;
        await this.storage.put(storageKey, image.data, image.contentType);

        try {
          const updated = await this.jobs.addEvidence(
            id,
            {
              id: evidenceId,
              uploadedById: user.userId,
              contentType: image.contentType,
              sizeBytes: image.data.length,
              width: image.width,
              height: image.height,
              sha256,
              storageKey,
              capturedAt: new Date(dto.capturedAt),
            },
            EVIDENCE_PER_JOB,
            mutation,
          );
          this.publishChange(updated, 'evidence', user.userId);
          return JobDetailDto.from(updated, user);
        } catch (error) {
          await this.releaseUnrecordedObject(evidenceId, storageKey);
          if (error instanceof EvidenceLimitError) {
            throw JobErrors.evidenceLimitReached(EVIDENCE_PER_JOB);
          }
          if (error instanceof ChildIdTakenError) {
            // The same upload sent twice at once: the other request recorded it.
            const winner = await this.jobs.findEvidence(evidenceId);
            if (winner?.jobId === id && winner.uploadedById === user.userId) {
              return JobDetailDto.from(await this.loadVisible(user, id), user);
            }
            throw JobErrors.idempotencyKeyReused();
          }
          throw error;
        }
      },
    );
  }

  /**
   * The bytes of one photo, for anyone who may see the job (its worker, its staff).
   * Evidence of another job, or of a job the caller may not see, is not found.
   */
  async evidenceContent(
    user: AuthenticatedUser,
    jobId: string,
    evidenceId: string,
  ): Promise<EvidenceContent> {
    const job = await this.loadVisible(user, jobId);
    const evidence = await this.jobs.findEvidence(evidenceId.toLowerCase());
    if (evidence === null || evidence.jobId !== job.id) {
      throw JobErrors.evidenceNotFound();
    }
    const data = await this.storage.get(evidence.storageKey);
    if (data === null) {
      this.logger.warn(
        `Evidence object missing from storage (evidenceId=${evidence.id})`,
      );
      throw JobErrors.evidenceNotFound();
    }
    const extension = evidence.contentType === 'image/png' ? 'png' : 'jpg';
    return {
      data,
      contentType: evidence.contentType,
      fileName: `${evidence.id}.${extension}`,
    };
  }

  /**
   * A message on the job, from its assigned worker or its staff. Append-only; the message ID
   * comes from the sending device, so sending it again is a replay.
   */
  sendMessage(
    user: AuthenticatedUser,
    id: string,
    dto: SendJobMessageDto,
    idempotencyKey?: string,
  ): Promise<JobDetailDto> {
    return this.idempotent(
      user,
      idempotencyKey,
      'job.message.send',
      id,
      201,
      async mutation => {
        const job = await this.loadVisible(user, id);
        this.assertPermitted(user, job, JobAction.MESSAGE);
        const messageId = dto.id.toLowerCase();
        try {
          const updated = await this.jobs.addMessage(
            id,
            {
              id: messageId,
              authorId: user.userId,
              body: dto.body,
              occurredAt: new Date(dto.occurredAt),
            },
            mutation,
          );
          this.events.publish({
            type: 'job.message.created',
            organizationId: updated.organizationId,
            jobId: updated.id,
            jobTitle: updated.title,
            messageId,
            authorId: user.userId,
            authorRole: user.role,
            createdById: updated.createdById,
            managerId: updated.managerId,
            assignedWorkerId: updated.assignedWorkerId,
          });
          return JobDetailDto.from(updated, user);
        } catch (error) {
          if (!(error instanceof ChildIdTakenError)) {
            throw error;
          }
          const existing = await this.jobs.findMessage(messageId);
          if (existing?.jobId === id && existing.authorId === user.userId) {
            return JobDetailDto.from(await this.loadVisible(user, id), user);
          }
          throw JobErrors.idempotencyKeyReused();
        }
      },
    );
  }

  // ---- Internals -------------------------------------------------------------------

  /** A worker status command: idempotent by key, then a transition. */
  private workerStep(
    user: AuthenticatedUser,
    id: string,
    transition: JobTransition,
    operation: JobOperation,
    idempotencyKey: string | undefined,
    plan: (job: JobDetailRecord) => TransitionPlan | Promise<TransitionPlan>,
  ): Promise<JobDetailDto> {
    return this.idempotent(user, idempotencyKey, operation, id, 200, mutation =>
      this.transition(user, id, transition, {
        prepare: async job => plan(job),
        ...(mutation !== undefined && { mutation }),
      }),
    );
  }

  /** The submission's checks and the writes that record it. */
  private async submissionPlan(
    user: AuthenticatedUser,
    job: JobDetailRecord,
    dto: SubmitJobDto,
  ): Promise<TransitionPlan> {
    const problems = submissionProblems(
      {
        type: job.type,
        requiresPhoto: job.requiresPhoto,
        photoCount: job.evidence.length,
        checklist: job.checklistItems,
        lines: job.lines,
        expectedAmount:
          job.expectedAmount === null ? null : toAmount(job.expectedAmount),
      },
      dto,
    );
    if (problems.length > 0) {
      throw BusinessErrors.requirementsNotMet(problems);
    }

    let orderLines: JobLineInput[] = [];
    if (job.type === JobType.ORDER_COLLECTION && dto.orderLines !== undefined) {
      const products = await this.catalog.activeProductsById(
        job.organizationId,
        dto.orderLines.map(line => line.productId),
        'orderLines',
      );
      orderLines = dto.orderLines.map(line => {
        const product = products.get(line.productId)!;
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          orderItemId: null,
          expectedQuantity: null,
          quantity: line.quantity,
        };
      });
    }
    const { currency } = job.organization;

    return {
      eventType: JobEventType.SUBMITTED,
      fields: {
        submittedAt: new Date(),
        submissionNote: dto.note ?? null,
      },
      ...withLocation(job, dto.location),
      work: async tx => {
        for (const answer of dto.checklist ?? []) {
          await tx.jobChecklistItem.update({
            where: { id: answer.itemId },
            data: {
              checked: answer.checked,
              responseNote: answer.note ?? null,
            },
          });
        }
        for (const count of dto.lineCounts ?? []) {
          await tx.jobLine.update({
            where: { id: count.lineId },
            data: { quantity: count.quantity },
          });
        }
        if (job.type === JobType.ORDER_COLLECTION) {
          // A resubmission (after a rejection) replaces the lines of the earlier one.
          await tx.jobLine.deleteMany({ where: { jobId: job.id } });
          await tx.jobLine.createMany({
            data: orderLines.map((line, position) => ({
              ...line,
              position,
              jobId: job.id,
            })),
          });
        }
        if (dto.payment !== undefined && job.orderId !== null) {
          const payment = await recordPendingPayment(tx, {
            id: dto.payment.id.toLowerCase(),
            organizationId: job.organizationId,
            orderId: job.orderId,
            jobId: job.id,
            amount: BigInt(dto.payment.amount),
            method: dto.payment.method,
            reference: normalizeReference(dto.payment.reference),
            collectedAt: new Date(dto.payment.collectedAt),
            recordedById: user.userId,
            currency,
          });
          await writeAudit(tx, {
            organizationId: job.organizationId,
            actorId: user.userId,
            action: 'payment.submitted',
            entityType: 'payment',
            entityId: payment.id,
            summary: `Payment of ${formatMoney(dto.payment.amount, currency)} submitted from ${job.shop?.name ?? job.customerName}`,
            data: {
              jobId: job.id,
              orderId: job.orderId,
              method: payment.method,
              reference: payment.reference,
            },
          });
        }
      },
    };
  }

  /** What a verification makes true, per type (inside its transaction). */
  private async applyVerification(
    tx: Tx,
    job: JobDetailRecord,
    user: AuthenticatedUser,
    context: {
      readonly now: Date;
      readonly today: string;
      readonly dueDate: string | undefined;
      readonly currency: string;
    },
  ): Promise<void> {
    const audits: AuditRecord[] = [
      {
        organizationId: job.organizationId,
        actorId: user.userId,
        action: 'operation.verified',
        entityType: 'operation',
        entityId: job.id,
        summary: `“${job.title}” verified`,
      },
    ];
    switch (job.type) {
      case JobType.PAYMENT_COLLECTION: {
        const pending = await tx.payment.findMany({
          where: { jobId: job.id, status: 'PENDING_VERIFICATION' },
        });
        for (const payment of pending) {
          await verifyPayment(tx, payment.id, user.userId, context.now);
          audits.push({
            organizationId: job.organizationId,
            actorId: user.userId,
            action: 'payment.verified',
            entityType: 'payment',
            entityId: payment.id,
            summary: `Payment of ${formatMoney(toAmount(payment.amount), context.currency)} verified`,
            data: { jobId: job.id, orderId: payment.orderId },
          });
        }
        break;
      }
      case JobType.DELIVERY: {
        if (job.orderId === null) {
          break;
        }
        const lines = await tx.jobLine.findMany({ where: { jobId: job.id } });
        const order = await recordDelivery(
          tx,
          job.orderId,
          lines.flatMap(line =>
            line.orderItemId === null
              ? []
              : [
                  {
                    orderItemId: line.orderItemId,
                    quantity: line.quantity ?? 0,
                  },
                ],
          ),
        );
        audits.push({
          organizationId: job.organizationId,
          actorId: user.userId,
          action: 'order.delivery_recorded',
          entityType: 'order',
          entityId: order.id,
          summary: `Delivery for ${order.orderNumber} recorded (${order.status})`,
          data: { jobId: job.id },
        });
        break;
      }
      case JobType.ORDER_COLLECTION: {
        if (job.shopId === null || context.dueDate === undefined) {
          break;
        }
        const lines = await tx.jobLine.findMany({
          where: { jobId: job.id },
          orderBy: { position: 'asc' },
          include: { product: true },
        });
        const order = await createOrder(tx, {
          organizationId: job.organizationId,
          shopId: job.shopId,
          createdById: user.userId,
          items: lines.map(line => ({
            product: line.product,
            quantity: line.quantity ?? 0,
          })),
          orderDate: dateOnly(context.today),
          dueDate: dateOnly(context.dueDate),
          notes: job.submissionNote,
          sourceJobId: job.id,
        });
        await tx.job.update({
          where: { id: job.id },
          data: { orderId: order.id },
        });
        audits.push({
          organizationId: job.organizationId,
          actorId: user.userId,
          action: 'order.created',
          entityType: 'order',
          entityId: order.id,
          summary: `Order ${order.orderNumber} taken at ${job.shop?.name ?? job.customerName}: ${formatMoney(toAmount(order.totalAmount), context.currency)}`,
          data: { jobId: job.id, total: toAmount(order.totalAmount) },
        });
        break;
      }
      case JobType.GENERAL:
      case JobType.SHOP_VISIT:
      case JobType.INVENTORY_CHECK:
        break;
    }
    await writeAudit(tx, ...audits);
  }

  /**
   * Where a new operation takes place and what it refers to, per type. Shop operations take
   * the shop's name, address and coordinates; references are checked against the caller's
   * organization and scope (another organization's shop or order is simply not found).
   */
  private async placeFor(
    scope: OrgScope,
    type: JobType,
    dto: CreateJobDto,
  ): Promise<{
    fields: {
      customerName: string;
      address: string;
      latitude: number | null;
      longitude: number | null;
      shopId: string | null;
      orderId: string | null;
      expectedAmount: bigint | null;
    };
    lines: JobLineInput[];
  }> {
    const forbid = (field: keyof CreateJobDto, message: string) => {
      if (dto[field] !== undefined) {
        throw BusinessErrors.invalid(field, message);
      }
    };
    const need = <Value>(
      value: Value | undefined,
      field: string,
      message: string,
    ): Value => {
      if (value === undefined) {
        throw BusinessErrors.invalid(field, message);
      }
      return value;
    };

    if (type === JobType.GENERAL) {
      for (const field of [
        'shopId',
        'orderId',
        'expectedAmount',
        'productIds',
      ] as const) {
        forbid(field, 'Only shop operations take this. Choose another type.');
      }
      return {
        fields: {
          customerName: need(
            dto.customerName,
            'customerName',
            'Customer is required.',
          ),
          address: need(dto.address, 'address', 'Address is required.'),
          latitude: dto.location?.latitude ?? null,
          longitude: dto.location?.longitude ?? null,
          shopId: null,
          orderId: null,
          expectedAmount: null,
        },
        lines: [],
      };
    }

    for (const field of ['customerName', 'address', 'location'] as const) {
      forbid(field, "A shop operation takes the shop's details.");
    }
    const shop = await this.shops.usable(
      scope,
      need(dto.shopId, 'shopId', 'Choose a shop.'),
      'shopId',
    );
    const at = {
      customerName: shop.name,
      address: shop.address,
      latitude: shop.latitude,
      longitude: shop.longitude,
      shopId: shop.id,
    };
    const needsOrder =
      type === JobType.DELIVERY || type === JobType.PAYMENT_COLLECTION;
    if (!needsOrder) {
      forbid(
        'orderId',
        'Only deliveries and payment collections refer to an order.',
      );
    }
    if (type !== JobType.PAYMENT_COLLECTION) {
      forbid(
        'expectedAmount',
        'Only a payment collection has an amount to collect.',
      );
    }
    if (type !== JobType.INVENTORY_CHECK) {
      forbid('productIds', 'Only an inventory check takes products to count.');
    }

    switch (type) {
      case JobType.DELIVERY: {
        const order = await this.orders.orderForOperation(
          scope,
          need(dto.orderId, 'orderId', 'Choose the order to deliver.'),
          shop.id,
          'orderId',
        );
        const lines = order.items.flatMap(item => {
          const remaining = item.quantity - item.deliveredQuantity;
          return remaining <= 0
            ? []
            : [
                {
                  productId: item.productId,
                  productName: item.productName,
                  sku: item.sku,
                  orderItemId: item.id,
                  expectedQuantity: remaining,
                  quantity: null,
                },
              ];
        });
        if (lines.length === 0) {
          throw BusinessErrors.invalidReference(
            'orderId',
            'Everything on this order has been delivered.',
          );
        }
        return {
          fields: { ...at, orderId: order.id, expectedAmount: null },
          lines,
        };
      }
      case JobType.PAYMENT_COLLECTION: {
        const order = await this.orders.orderForOperation(
          scope,
          need(dto.orderId, 'orderId', 'Choose the order to collect for.'),
          shop.id,
          'orderId',
        );
        const expected = BigInt(
          need(
            dto.expectedAmount,
            'expectedAmount',
            'Enter the amount to collect.',
          ),
        );
        const available = await this.orders.unassignedBalance(order.id);
        if (expected > available) {
          const { currency } = await this.orders.money(scope.organizationId);
          throw BusinessErrors.amountExceedsBalance(
            'expectedAmount',
            available === 0n
              ? 'Nothing is left to collect on this order (or it is already assigned to other collections).'
              : `The amount exceeds what is left to collect: ${formatMoney(toAmount(available), currency)}.`,
          );
        }
        return {
          fields: { ...at, orderId: order.id, expectedAmount: expected },
          lines: [],
        };
      }
      case JobType.INVENTORY_CHECK: {
        const ids = need(
          dto.productIds,
          'productIds',
          'Choose the products to count.',
        );
        if (new Set(ids).size !== ids.length) {
          throw BusinessErrors.invalid(
            'productIds',
            'A product is listed twice.',
          );
        }
        const products = await this.catalog.activeProductsById(
          scope.organizationId,
          ids,
          'productIds',
        );
        return {
          fields: { ...at, orderId: null, expectedAmount: null },
          lines: ids.map(id => {
            const product = products.get(id)!;
            return {
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              orderItemId: null,
              expectedQuantity: null,
              quantity: null,
            };
          }),
        };
      }
      case JobType.SHOP_VISIT:
        if ((dto.checklist ?? []).length === 0) {
          throw BusinessErrors.invalid(
            'checklist',
            'A shop visit needs a checklist for the worker to report on.',
          );
        }
        return {
          fields: { ...at, orderId: null, expectedAmount: null },
          lines: [],
        };
      case JobType.ORDER_COLLECTION:
        return {
          fields: { ...at, orderId: null, expectedAmount: null },
          lines: [],
        };
    }
  }

  /**
   * The operation's responsible manager: the caller when they are a manager; for an admin,
   * the named manager (an active MANAGER of the organization) or themselves.
   */
  private async responsibleManager(
    scope: OrgScope,
    managerId: string | undefined,
  ): Promise<string> {
    if (managerId === undefined || managerId === scope.userId) {
      return scope.userId;
    }
    if (scope.role !== Role.ORGANIZATION_ADMIN) {
      throw BusinessErrors.invalid(
        'managerId',
        'You are responsible for the operations you create.',
      );
    }
    const manager = await this.users.findMember(
      scope.organizationId,
      managerId,
    );
    if (
      manager === null ||
      !manager.isActive ||
      manager.role !== Role.MANAGER
    ) {
      throw BusinessErrors.invalidReference(
        'managerId',
        "The selected manager isn't an active manager in your organization.",
      );
    }
    return manager.id;
  }

  /**
   * Removes a stored object whose metadata could not be recorded, unless a row (a concurrent
   * identical upload) now refers to it. Best effort: a failure here is logged, not raised.
   */
  private async releaseUnrecordedObject(
    evidenceId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      const row = await this.jobs.findEvidence(evidenceId);
      if (row?.storageKey !== storageKey) {
        await this.storage.delete(storageKey);
      }
    } catch (error) {
      this.logger.warn(
        `Could not remove an unrecorded evidence object (evidenceId=${evidenceId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Runs a status command through the state machine. A command whose target the job has
   * already reached returns the job unchanged (safe retries); an invalid one is rejected.
   */
  private async transition(
    user: AuthenticatedUser,
    id: string,
    transition: JobTransition,
    options: {
      readonly sameAssignee?: (job: JobDetailRecord) => boolean;
      readonly prepare: (job: JobDetailRecord) => Promise<TransitionPlan>;
      /** Idempotency record, written in the same transaction as the change. */
      readonly mutation?: MutationRecord;
    },
  ): Promise<JobDetailDto> {
    const job = await this.loadVisible(user, id);
    this.assertPermitted(user, job, TRANSITION_ACTIONS[transition]);

    const decision = decideTransition(job.type, job.status, transition, {
      sameAssignee: options.sameAssignee?.(job) ?? false,
    });
    if (decision.kind === 'alreadyApplied') {
      if (options.mutation !== undefined) {
        // Remember the key, so a retry of it is a replay even after the job moves on.
        await this.jobs
          .recordMutation(options.mutation)
          .catch((error: unknown) => {
            if (!(error instanceof DuplicateMutationError)) {
              throw error;
            }
          });
      }
      return JobDetailDto.from(job, user);
    }
    if (decision.kind === 'rejected') {
      throw JobErrors.invalidTransition(
        TRANSITION_VERBS[transition],
        job.status,
      );
    }

    const plan = await options.prepare(job);
    const event: JobEventInput = {
      type: plan.eventType,
      fromStatus: job.status,
      toStatus: decision.to,
      actorId: user.userId,
      ...(plan.assigneeId !== undefined && { assigneeId: plan.assigneeId }),
      ...(plan.reason !== undefined && { reason: plan.reason }),
      ...(plan.location !== undefined && { location: plan.location }),
    };
    const updated = await this.jobs.update(id, job.version, {
      fields: { ...plan.fields, status: decision.to },
      event,
      ...(options.mutation !== undefined && { mutation: options.mutation }),
      ...(plan.work !== undefined && { work: plan.work }),
    });
    if (updated === null) {
      // Lost a race. If the winner did exactly this (a double tap: two identical
      // submissions at once), answer like a retry; anything else is a real conflict.
      const current = await this.jobs.findDetail(id);
      if (
        current !== null &&
        decideTransition(current.type, current.status, transition, {
          sameAssignee: options.sameAssignee?.(current) ?? false,
        }).kind === 'alreadyApplied'
      ) {
        return JobDetailDto.from(current, user);
      }
      throw JobErrors.versionConflict();
    }
    const previousAssignee =
      job.assignedWorkerId !== null &&
      job.assignedWorkerId !== updated.assignedWorkerId
        ? job.assignedWorkerId
        : null;
    this.publishChange(
      updated,
      TRANSITION_CHANGES[transition],
      user.userId,
      previousAssignee,
      plan.reason ?? null,
    );
    return JobDetailDto.from(updated, user);
  }

  /** Tells other modules (realtime, notifications) that a job changed. After the commit. */
  private publishChange(
    job: JobDetailRecord,
    change: JobChangeKind,
    actorId: string,
    previousAssigneeId: string | null = null,
    reason: string | null = null,
  ): void {
    const actor = job.events.findLast(
      event => event.actorId === actorId,
    )?.actor;
    const latestPayment = job.payments.at(-1);
    const amount =
      change === 'submitted' || change === 'verified'
        ? latestPayment === undefined
          ? null
          : toAmount(latestPayment.amount)
        : job.expectedAmount === null
          ? null
          : toAmount(job.expectedAmount);
    this.events.publish({
      type: 'job.changed',
      organizationId: job.organizationId,
      jobId: job.id,
      jobTitle: job.title,
      jobType: job.type,
      change,
      status: job.status,
      version: job.version,
      actorId,
      actorName: actor === undefined ? 'Someone' : fullName(actor),
      createdById: job.createdById,
      managerId: job.managerId,
      shopId: job.shopId,
      shopName: job.shop?.name ?? null,
      amount,
      currency: job.organization.currency,
      reason,
      assignedWorkerId: job.assignedWorkerId,
      previousAssigneeId,
    });
  }

  /**
   * Server-side idempotency for device commands (`Idempotency-Key`). The device reuses one
   * key for every attempt of a command, so an attempt whose response was lost comes back
   * with a key that is already recorded: it is answered from the record, never applied twice.
   *
   * - Key already recorded: replay (same command and job required).
   * - Two attempts at once: the database's primary key lets one record it; the other
   *   replays.
   * - No key: the command runs as a plain request (online clients, Swagger).
   */
  private async idempotent(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    operation: JobOperation,
    jobId: string,
    responseStatus: number,
    run: (mutation: MutationRecord | undefined) => Promise<JobDetailDto>,
  ): Promise<JobDetailDto> {
    if (idempotencyKey === undefined) {
      return run(undefined);
    }
    const earlier = await this.jobs.findMutation(user.userId, idempotencyKey);
    if (earlier !== null) {
      return this.replay(user, earlier, operation, jobId);
    }
    try {
      return await run({
        userId: user.userId,
        idempotencyKey,
        operation,
        jobId,
        responseStatus,
      });
    } catch (error) {
      if (error instanceof DuplicateMutationError) {
        const winner = await this.jobs.findMutation(
          user.userId,
          idempotencyKey,
        );
        if (winner !== null) {
          return this.replay(user, winner, operation, jobId);
        }
      }
      throw error;
    }
  }

  /**
   * Answers a repeated command with the job as it is now. The command succeeded earlier; the
   * device converges to the current server state, which may already include later changes.
   * A declined job is no longer the worker's to see, but the worker who declined it gets its
   * current state (the recorded key proves the decline was theirs).
   */
  private async replay(
    user: AuthenticatedUser,
    earlier: ProcessedMutation,
    operation: JobOperation,
    jobId: string,
  ): Promise<JobDetailDto> {
    if (earlier.operation !== operation || earlier.jobId !== jobId) {
      throw JobErrors.idempotencyKeyReused();
    }
    if (operation === 'job.decline') {
      const job = await this.jobs.findDetail(jobId);
      if (job === null) {
        throw JobErrors.notFound();
      }
      return JobDetailDto.from(job, user);
    }
    return JobDetailDto.from(await this.loadVisible(user, jobId), user);
  }

  /** The job, if it exists and the caller may see it; otherwise 404 either way. */
  private async loadVisible(
    user: AuthenticatedUser,
    id: string,
  ): Promise<JobDetailRecord> {
    orgScope(user);
    const job = await this.jobs.findDetail(id);
    if (job === null || !canView(user, job)) {
      throw JobErrors.notFound();
    }
    return job;
  }

  private assertPermission(
    user: AuthenticatedUser,
    permission: JobPermission,
  ): void {
    if (!hasPermission(user.role, permission)) {
      throw AuthErrors.forbidden();
    }
  }

  private assertPermitted(
    user: AuthenticatedUser,
    job: JobDetailRecord,
    action: JobAction,
  ): void {
    if (!isPermitted(user, job, action)) {
      throw AuthErrors.forbidden();
    }
  }
}

/** The plan's location part for a fix the phone may have sent. */
function withLocation(
  job: Pick<JobDetailRecord, 'latitude' | 'longitude'>,
  fix: DeviceLocationDto | undefined,
): { location?: EventLocationInput } {
  return fix === undefined ? {} : { location: eventLocation(job, fix) };
}

/** The column changes a PATCH asks for; absent fields are left out. */
function fieldChanges(dto: UpdateJobDto): JobFieldChanges {
  return {
    ...(dto.title !== undefined && { title: dto.title }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.customerName !== undefined && { customerName: dto.customerName }),
    ...(dto.address !== undefined && { address: dto.address }),
    ...(dto.location !== undefined && {
      latitude: dto.location?.latitude ?? null,
      longitude: dto.location?.longitude ?? null,
    }),
    ...(dto.scheduledAt !== undefined && {
      scheduledAt: new Date(dto.scheduledAt),
    }),
    ...(dto.priority !== undefined && { priority: dto.priority }),
    ...(dto.notes !== undefined && { notes: dto.notes }),
  };
}
