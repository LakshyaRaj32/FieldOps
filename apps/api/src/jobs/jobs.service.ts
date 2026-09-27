import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AppException, AuthErrors } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { Role } from '../users/role.js';
import {
  DomainEvents,
  type JobChangeKind,
} from '../events/domain-events.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
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
  type JobOperation,
  type MutationRecord,
} from './data/jobs.repository.js';
import { inspectImage } from './domain/evidence-image.js';
import { eventLocation } from './domain/job-location.js';
import type { ProcessedMutation } from '../generated/prisma/client.js';
import {
  decideTransition,
  isChecklistEditable,
  isDeletable,
  isEditable,
  type JobTransition,
} from '@fieldops/shared';
import {
  canView,
  hasPermission,
  isPermitted,
  type JobPermission,
} from './domain/job.policy.js';
import type {
  AddJobEvidenceDto,
  AddJobNoteDto,
  SendJobMessageDto,
} from './dto/job-command.dto.js';
import type { DeviceLocationDto } from './dto/job-fields.js';
import type { CreateJobDto } from './dto/create-job.dto.js';
import type { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
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
} from './job-enums.js';
import { JobErrors } from './job.errors.js';

const DEFAULT_PAGE_SIZE = 20;

/** Closed jobs stay in a worker's offline working set this long after their last change. */
const WORKING_SET_CLOSED_DAYS = 7;
/** Upper bound on the working set (far above a worker's realistic open jobs). */
const WORKING_SET_LIMIT = 200;

/** Past participles for "A job that is completed can't be started." */
const TRANSITION_VERBS: Readonly<Record<JobTransition, string>> = {
  assign: 'assigned',
  start: 'started',
  complete: 'completed',
  cancel: 'cancelled',
};

/** Per transition: the history entry type and the fields that change besides status. */
interface TransitionPlan {
  readonly eventType: JobEventType;
  readonly fields: JobFieldChanges;
  readonly assigneeId?: string;
  /** Where the worker was (start and complete, when the phone sent a fix). */
  readonly location?: EventLocationInput;
}

/** What a transition is called in job.changed events. */
const TRANSITION_CHANGES: Readonly<Record<JobTransition, JobChangeKind>> = {
  assign: 'assigned',
  start: 'started',
  complete: 'completed',
  cancel: 'cancelled',
};

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

/**
 * Job use cases. Every operation follows the same order, so failures are consistent:
 *
 * 1. load the job; if the caller may not see it → 404 (existence is not revealed)
 * 2. check the caller's permission and relationship to the job → 403
 * 3. check what the job's status allows → 409
 * 4. write with a compare-and-set on `version` (plus a history event) → 409 on a race
 *
 * Authorization decisions come from domain/job.policy.ts and status rules from
 * @fieldops/shared (the job state machine); this class only orchestrates.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly users: UsersService,
    private readonly events: DomainEvents,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateJobDto,
  ): Promise<JobDetailDto> {
    this.assertPermission(user, 'job:create');
    const job = await this.jobs.create(
      {
        title: dto.title,
        description: dto.description ?? null,
        customerName: dto.customerName,
        address: dto.address,
        latitude: dto.location?.latitude ?? null,
        longitude: dto.location?.longitude ?? null,
        scheduledAt: new Date(dto.scheduledAt),
        priority: dto.priority ?? JobPriority.NORMAL,
        notes: dto.notes ?? null,
        createdById: user.userId,
      },
      dto.checklist ?? [],
      {
        type: JobEventType.CREATED,
        fromStatus: null,
        toStatus: JobStatus.PENDING,
        actorId: user.userId,
      },
    );
    return JobDetailDto.from(job, user);
  }

  /**
   * Workers always get exactly their own jobs: the filter is forced server-side, and asking
   * for another worker's jobs is refused rather than silently ignored.
   */
  async list(
    user: AuthenticatedUser,
    query: ListJobsQueryDto,
  ): Promise<JobPageDto> {
    let assignedWorkerId = query.assignedWorkerId;
    if (!hasPermission(user.role, 'job:read:all')) {
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
      order: query.order ?? 'asc',
      limit,
      ...(query.status !== undefined && { statuses: query.status }),
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
   * Everything the worker's device keeps offline, as one snapshot. The device replaces its
   * copy with it, so a job that disappears here (reassigned, or closed long ago) leaves the
   * device once its pending changes have been resolved.
   */
  async workingSet(user: AuthenticatedUser): Promise<JobWorkingSetDto> {
    this.assertPermission(user, 'job:read:assigned');
    const generatedAt = new Date();
    const closedSince = new Date(
      generatedAt.getTime() - WORKING_SET_CLOSED_DAYS * 86_400_000,
    );
    const jobs = await this.jobs.workingSet(
      user.userId,
      closedSince,
      WORKING_SET_LIMIT,
    );
    return Object.assign(new JobWorkingSetDto(), {
      jobs: jobs.map(job => JobDetailDto.from(job, user)),
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
        "Completed and cancelled jobs can't be changed.",
      );
    }
    if (dto.version !== job.version) {
      throw JobErrors.versionConflict();
    }
    if (dto.checklist !== undefined && !isChecklistEditable(job.status)) {
      throw JobErrors.notEditable(
        "The checklist can't be changed after the job has started.",
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
        'Only pending jobs can be deleted. Cancel the job instead.',
      );
    }
    if (!(await this.jobs.deletePending(id, job.version))) {
      throw JobErrors.versionConflict();
    }
  }

  assign(
    user: AuthenticatedUser,
    id: string,
    workerId: string,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'assign', {
      sameAssignee: job => job.assignedWorkerId === workerId,
      prepare: async () => {
        const worker = await this.users.findById(workerId);
        if (
          worker === null ||
          !worker.isActive ||
          worker.role !== Role.WORKER
        ) {
          throw JobErrors.invalidAssignee();
        }
        return {
          eventType: JobEventType.ASSIGNED,
          fields: { assignedWorkerId: workerId },
          assigneeId: workerId,
        };
      },
    });
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
    return this.idempotent(
      user,
      idempotencyKey,
      'job.start',
      id,
      200,
      mutation =>
        this.transition(user, id, 'start', {
          prepare: async job => ({
            eventType: JobEventType.STARTED,
            fields: { startedAt: new Date() },
            ...withLocation(job, location),
          }),
          ...(mutation !== undefined && { mutation }),
        }),
    );
  }

  /** The assigned worker completes the job. Retries with the same key are replays. */
  complete(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey?: string,
    location?: DeviceLocationDto,
  ): Promise<JobDetailDto> {
    return this.idempotent(
      user,
      idempotencyKey,
      'job.complete',
      id,
      200,
      mutation =>
        this.transition(user, id, 'complete', {
          prepare: async job => ({
            eventType: JobEventType.COMPLETED,
            fields: { completedAt: new Date() },
            ...withLocation(job, location),
          }),
          ...(mutation !== undefined && { mutation }),
        }),
    );
  }

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
   * The assigned worker attaches a photo, on a job in any status (like notes). The file is
   * checked from its bytes (JPEG or PNG only, bounded dimensions), stripped of metadata,
   * stored in object storage, and only then recorded. The evidence ID comes from the device:
   * uploading the same evidence again is a replay, not a second photo.
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
              sha256: createHash('sha256').update(image.data).digest('hex'),
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
   * The bytes of one photo, for anyone who may see the job (its worker, managers). Evidence
   * of another job, or of a job the caller may not see, is not found.
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
   * A message on the job, from its assigned worker or a manager. Append-only; the message ID
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
            jobId: updated.id,
            jobTitle: updated.title,
            messageId,
            authorId: user.userId,
            authorRole: user.role,
            createdById: updated.createdById,
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

  cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string | undefined,
  ): Promise<JobDetailDto> {
    return this.transition(user, id, 'cancel', {
      prepare: async () => ({
        eventType: JobEventType.CANCELLED,
        fields: { cancelledAt: new Date(), cancellationReason: reason ?? null },
      }),
    });
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
    this.assertPermitted(user, job, transition);

    const decision = decideTransition(job.status, transition, {
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
      ...(plan.location !== undefined && { location: plan.location }),
    };
    const updated = await this.jobs.update(id, job.version, {
      fields: { ...plan.fields, status: decision.to },
      event,
      ...(options.mutation !== undefined && { mutation: options.mutation }),
    });
    if (updated === null) {
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
    );
    return JobDetailDto.from(updated, user);
  }

  /** Tells other modules (realtime, notifications) that a job changed. After the commit. */
  private publishChange(
    job: JobDetailRecord,
    change: JobChangeKind,
    actorId: string,
    previousAssigneeId: string | null = null,
  ): void {
    this.events.publish({
      type: 'job.changed',
      jobId: job.id,
      jobTitle: job.title,
      change,
      status: job.status,
      version: job.version,
      actorId,
      createdById: job.createdById,
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
    return JobDetailDto.from(await this.loadVisible(user, jobId), user);
  }

  /** The job, if it exists and the caller may see it; otherwise 404 either way. */
  private async loadVisible(
    user: AuthenticatedUser,
    id: string,
  ): Promise<JobDetailRecord> {
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
