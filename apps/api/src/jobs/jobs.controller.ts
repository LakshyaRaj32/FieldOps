import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
} from '../common/decorators/idempotency-key.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { rolesWith } from './domain/job.policy.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import {
  AddJobNoteDto,
  AssignJobDto,
  CancelJobDto,
  JobIdParamDto,
} from './dto/job-command.dto.js';
import {
  JobDetailDto,
  JobPageDto,
  JobWorkingSetDto,
} from './dto/job-response.dto.js';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobsService } from './jobs.service.js';

const INVALID = {
  status: HttpStatus.BAD_REQUEST,
  description: 'VALIDATION_ERROR: invalid or unknown fields.',
};
const UNAUTHENTICATED = {
  status: HttpStatus.UNAUTHORIZED,
  description: 'Not authenticated.',
};
const FORBIDDEN = {
  status: HttpStatus.FORBIDDEN,
  description: 'FORBIDDEN: the role may not do this.',
};
const NOT_FOUND = {
  status: HttpStatus.NOT_FOUND,
  description:
    'NOT_FOUND: no such job, or not one the caller may see (a worker sees only their own).',
};
/** Documents the header offline clients send with every command (see api.md, "Offline sync"). */
const IdempotencyKeyHeader = () =>
  ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      'UUID generated once per command and repeated on every retry. A retry of a command the ' +
      'server already applied returns the current job instead of applying it again.',
  });

const WRONG_STATUS = {
  status: HttpStatus.CONFLICT,
  description:
    "INVALID_STATUS_TRANSITION: the job's status does not allow this; VERSION_CONFLICT: the job changed concurrently.",
};

/**
 * Jobs under /api/v1/jobs. Transport only: every rule (who may do what, which status changes
 * exist) lives in JobsService and the domain policy. Route gates below come from the same
 * permission table the service checks, so they cannot disagree.
 *
 * Status never changes through PATCH: it moves only through the action endpoints
 * (assign, start, complete, cancel), each validated by the job state machine.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @Roles(...rolesWith('job:create'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a job (MANAGER, ADMIN)',
    description:
      'The job starts PENDING. Assign a worker with POST /jobs/{id}/assign.',
  })
  @ApiEnvelopeResponse(JobDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The created job.',
  })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List jobs',
    description:
      'Managers and admins see every job; workers see only jobs assigned to them. ' +
      'Ordered by scheduled time, then creation. Cursor-paginated.',
  })
  @ApiEnvelopeResponse(JobPageDto, { description: 'One page of jobs.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, {
    status: HttpStatus.FORBIDDEN,
    description: "FORBIDDEN: a worker asked for another worker's jobs.",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListJobsQueryDto,
  ): Promise<JobPageDto> {
    return this.jobs.list(user, query);
  }

  // Declared before GET /jobs/:id so "working-set" is not taken for a job ID.
  @Get('working-set')
  @Roles(...rolesWith('job:read:assigned'))
  @ApiOperation({
    summary: "The worker's offline working set (WORKER)",
    description:
      'Full details of every open job assigned to the caller, plus jobs closed in the last ' +
      '7 days. The mobile app stores it in SQLite; a job missing from it is no longer the ' +
      "worker's to see.",
  })
  @ApiEnvelopeResponse(JobWorkingSetDto, { description: 'The snapshot.' })
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN)
  workingSet(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobWorkingSetDto> {
    return this.jobs.workingSet(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Job details, checklist, history and field notes' })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, NOT_FOUND)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
  ): Promise<JobDetailDto> {
    return this.jobs.get(user, params.id);
  }

  @Patch(':id')
  @Roles(...rolesWith('job:edit'))
  @ApiOperation({
    summary: 'Edit job details (MANAGER, ADMIN)',
    description:
      'Partial update with optimistic concurrency: send the `version` you read. ' +
      'Completed and cancelled jobs are read-only; the checklist is fixed once started.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The updated job.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, {
    status: HttpStatus.CONFLICT,
    description:
      'VERSION_CONFLICT: the job changed since it was read; JOB_NOT_EDITABLE: closed job or started checklist.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: UpdateJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.update(user, params.id, dto);
  }

  @Delete(':id')
  @Roles(...rolesWith('job:delete'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a pending job (MANAGER, ADMIN)',
    description:
      'Only never-assigned (PENDING) jobs can be deleted; cancel any other job instead.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, {
    status: HttpStatus.CONFLICT,
    description: 'JOB_NOT_EDITABLE: the job is not PENDING.',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
  ): Promise<void> {
    return this.jobs.remove(user, params.id);
  }

  @Post(':id/assign')
  @Roles(...rolesWith('job:assign'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign or reassign a worker (MANAGER, ADMIN)',
    description:
      'PENDING or ASSIGNED jobs only. Assigning the current assignee again is a no-op.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now ASSIGNED.' })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description: 'INVALID_ASSIGNEE: no such user, disabled, or not a WORKER.',
    },
  )
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: AssignJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.assign(user, params.id, dto.workerId);
  }

  @Post(':id/start')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an assigned job (the assigned WORKER)',
    description:
      'ASSIGNED → IN_PROGRESS. Repeating it on an IN_PROGRESS job succeeds without changes.',
  })
  @ApiEnvelopeResponse(JobDetailDto, {
    description: 'The job, now IN_PROGRESS.',
  })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, WRONG_STATUS)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.start(user, params.id, idempotencyKey);
  }

  @Post(':id/complete')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete an in-progress job (the assigned WORKER)',
    description:
      'IN_PROGRESS → COMPLETED. Repeating it on a COMPLETED job succeeds without changes.',
  })
  @IdempotencyKeyHeader()
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now COMPLETED.' })
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, WRONG_STATUS)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.complete(user, params.id, idempotencyKey);
  }

  @Post(':id/notes')
  @Roles(...rolesWith('job:note'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a field note (the assigned WORKER)',
    description:
      'Append-only, on a job in any status. The note ID comes from the device: sending the ' +
      'same note again changes nothing.',
  })
  @IdempotencyKeyHeader()
  @ApiEnvelopeResponse(JobDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The job with the note.',
  })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description:
      'IDEMPOTENCY_KEY_REUSED: the key or note ID belongs to a different request.',
  })
  addNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: AddJobNoteDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.addNote(user, params.id, dto, idempotencyKey);
  }

  @Post(':id/cancel')
  @Roles(...rolesWith('job:cancel'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a job (MANAGER, ADMIN)',
    description:
      'Any status before COMPLETED. Cancelled jobs are closed for good.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now CANCELLED.' })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: CancelJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.cancel(user, params.id, dto.reason);
  }
}
