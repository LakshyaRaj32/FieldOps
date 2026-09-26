import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, AuthErrors } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { Role } from '../users/role.js';
import { UsersService } from '../users/users.service.js';
import { decodeJobCursor, encodeJobCursor } from './data/job-cursor.js';
import {
  JobsRepository,
  type JobDetailRecord,
  type JobEventInput,
  type JobFieldChanges,
} from './data/jobs.repository.js';
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
import type { CreateJobDto } from './dto/create-job.dto.js';
import type { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import {
  JobDetailDto,
  JobPageDto,
  JobSummaryDto,
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
  constructor(
    private readonly jobs: JobsRepository,
    private readonly users: UsersService,
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

  start(user: AuthenticatedUser, id: string): Promise<JobDetailDto> {
    return this.transition(user, id, 'start', {
      prepare: async () => ({
        eventType: JobEventType.STARTED,
        fields: { startedAt: new Date() },
      }),
    });
  }

  complete(user: AuthenticatedUser, id: string): Promise<JobDetailDto> {
    return this.transition(user, id, 'complete', {
      prepare: async () => ({
        eventType: JobEventType.COMPLETED,
        fields: { completedAt: new Date() },
      }),
    });
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
      readonly prepare: () => Promise<TransitionPlan>;
    },
  ): Promise<JobDetailDto> {
    const job = await this.loadVisible(user, id);
    this.assertPermitted(user, job, transition);

    const decision = decideTransition(job.status, transition, {
      sameAssignee: options.sameAssignee?.(job) ?? false,
    });
    if (decision.kind === 'alreadyApplied') {
      return JobDetailDto.from(job, user);
    }
    if (decision.kind === 'rejected') {
      throw JobErrors.invalidTransition(
        TRANSITION_VERBS[transition],
        job.status,
      );
    }

    const plan = await options.prepare();
    const event: JobEventInput = {
      type: plan.eventType,
      fromStatus: job.status,
      toStatus: decision.to,
      actorId: user.userId,
      ...(plan.assigneeId !== undefined && { assigneeId: plan.assigneeId }),
    };
    const updated = await this.jobs.update(id, job.version, {
      fields: { ...plan.fields, status: decision.to },
      event,
    });
    if (updated === null) {
      throw JobErrors.versionConflict();
    }
    return JobDetailDto.from(updated, user);
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
