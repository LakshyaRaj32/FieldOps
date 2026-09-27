import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
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
  AddJobEvidenceDto,
  AddJobNoteDto,
  AssignJobDto,
  CancelJobDto,
  DeclineJobDto,
  FailJobDto,
  JobCommandDto,
  JobEvidenceParamDto,
  JobIdParamDto,
  RejectJobDto,
  RescheduleJobDto,
  SendJobMessageDto,
  SubmitJobDto,
  VerifyJobDto,
} from './dto/job-command.dto.js';
import {
  JobDetailDto,
  JobPageDto,
  JobWorkingSetDto,
} from './dto/job-response.dto.js';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { JobOverviewDto } from './dto/job-overview.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import {
  EVIDENCE_MAX_BYTES,
  JobsService,
  type UploadedEvidenceFile,
} from './jobs.service.js';

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
    'NOT_FOUND: no such job, or not one the caller may see (another organization, another team, or a worker who is not assigned).',
};
const REQUIREMENTS = {
  status: HttpStatus.UNPROCESSABLE_ENTITY,
  description:
    'REQUIREMENTS_NOT_MET (details list what is missing), AMOUNT_EXCEEDS_BALANCE, INVALID_REFERENCE.',
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
 * Status never changes through PATCH: it moves only through the action endpoints, each
 * validated by the state machine of the operation's type (@fieldops/shared).
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
    summary: 'Create an operation (MANAGER, ORGANIZATION_ADMIN)',
    description:
      'It starts PENDING; assign a worker with POST /jobs/{id}/assign. GENERAL jobs take a ' +
      'customer and address; every other type a shop in the caller scope, deliveries ' +
      'and payment collections an open order of that shop (a collection also the amount, ' +
      'at most what is left to collect), inventory checks the products to count, shop ' +
      'visits a checklist.',
  })
  @ApiEnvelopeResponse(JobDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The created job.',
  })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN, REQUIREMENTS)
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
      'Organization admins (and managers with organization-wide access) see every ' +
      'operation of their organization, other managers the ones they are responsible for, ' +
      'workers only those assigned to them. Ordered by due time. Cursor-paginated.',
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

  // Declared before GET /jobs/:id so "overview" is not taken for a job ID.
  @Get('overview')
  @Roles(...rolesWith('job:read:all'))
  @ApiOperation({
    summary: 'Dashboard figures in my scope (MANAGER, ORGANIZATION_ADMIN)',
    description:
      'Operations by status, overdue and due soon, awaiting verification, closed in the ' +
      'last 7 days; the team (busy, available, online); money (outstanding, due today, ' +
      'overdue, collected today, pending verification); shops (visited today, pending ' +
      'visits); workload and activity. Money and visits use the organization calendar day.',
  })
  @ApiEnvelopeResponse(JobOverviewDto, { description: 'The figures.' })
  @ApiErrorResponses(UNAUTHENTICATED, FORBIDDEN)
  overview(@CurrentUser() user: AuthenticatedUser): Promise<JobOverviewDto> {
    return this.jobs.overview(user);
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
    summary: 'Edit job details (MANAGER, ORGANIZATION_ADMIN)',
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
    summary: 'Delete a pending job (MANAGER, ORGANIZATION_ADMIN)',
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
    summary: 'Assign or reassign a worker (MANAGER, ORGANIZATION_ADMIN)',
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

  @Post(':id/accept')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an assigned operation (the assigned WORKER)',
    description: 'ASSIGNED → ACCEPTED. Repeating it succeeds without changes.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now ACCEPTED.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.accept(user, params.id, idempotencyKey);
  }

  @Post(':id/decline')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hand an operation back (the assigned WORKER)',
    description:
      'ASSIGNED or ACCEPTED → PENDING, with a reason; the responsible manager is told. ' +
      'The operation leaves the worker afterwards.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now PENDING.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: DeclineJobDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.decline(user, params.id, dto.reason, idempotencyKey);
  }

  @Post(':id/depart')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set off for the shop (the assigned WORKER)',
    description: 'ACCEPTED → EN_ROUTE, optionally with the position.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now EN_ROUTE.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  depart(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: JobCommandDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.depart(user, params.id, idempotencyKey, dto.location);
  }

  @Post(':id/arrive')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report arriving at the shop (the assigned WORKER)',
    description:
      'EN_ROUTE → ARRIVED. The position is recorded and its distance from the shop ' +
      'computed; managers see it, flagged beyond the organization radius. It never refuses ' +
      'the step (GPS can be wrong).',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now ARRIVED.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  arrive(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: JobCommandDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.arrive(user, params.id, idempotencyKey, dto.location);
  }

  @Post(':id/submit')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit the result for verification (the assigned WORKER)',
    description:
      'IN_PROGRESS → SUBMITTED. What is required depends on the type: proof photos for ' +
      'deliveries and collections, every checklist answer for visits and counts, the ' +
      'delivered or counted quantities, the new order lines, or the payment collected ' +
      '(never more than the order still owes; a reference except for cash, used once). ' +
      'Nothing takes effect before a manager verifies it.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now SUBMITTED.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
    REQUIREMENTS,
    {
      status: HttpStatus.CONFLICT,
      description: 'DUPLICATE_PAYMENT_REFERENCE',
    },
  )
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: SubmitJobDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.submit(user, params.id, dto, idempotencyKey);
  }

  @Post(':id/fail')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Report that the operation cannot be carried out (the assigned WORKER)',
    description:
      'ACCEPTED, EN_ROUTE, ARRIVED or IN_PROGRESS → FAILED, with a reason.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now FAILED.' })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  fail(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: FailJobDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.fail(
      user,
      params.id,
      dto.reason,
      idempotencyKey,
      dto.location,
    );
  }

  @Post(':id/verify')
  @Roles(...rolesWith('job:review'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a submitted result (MANAGER, ORGANIZATION_ADMIN)',
    description:
      'SUBMITTED → COMPLETED. Now it takes effect: the payment counts towards the order, ' +
      'the delivery raises delivered quantities, the order collection becomes an order.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now COMPLETED.' })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: VerifyJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.verify(user, params.id, dto);
  }

  @Post(':id/reject')
  @Roles(...rolesWith('job:review'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a submitted result back for rework (MANAGER, ORGANIZATION_ADMIN)',
    description:
      'SUBMITTED → IN_PROGRESS, with a reason; a submitted payment is rejected (it never counts).',
  })
  @ApiEnvelopeResponse(JobDetailDto, {
    description: 'The job, now IN_PROGRESS.',
  })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: RejectJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.reject(user, params.id, dto.reason);
  }

  @Post(':id/reschedule')
  @Roles(...rolesWith('job:reschedule'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move the due time (MANAGER, ORGANIZATION_ADMIN)',
    description:
      'Before the worker sets off. An accepted operation returns to ASSIGNED so the worker ' +
      'confirms the new time; the worker is notified.',
  })
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job.' })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: RescheduleJobDto,
  ): Promise<JobDetailDto> {
    return this.jobs.reschedule(user, params.id, dto);
  }

  @Post(':id/start')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the work (the assigned WORKER)',
    description:
      'GENERAL: ASSIGNED → IN_PROGRESS; other types: ARRIVED → IN_PROGRESS. Repeating it on ' +
      "an IN_PROGRESS job succeeds without changes. The body may carry the phone's position.",
  })
  @ApiEnvelopeResponse(JobDetailDto, {
    description: 'The job, now IN_PROGRESS.',
  })
  @IdempotencyKeyHeader()
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: JobCommandDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.start(user, params.id, idempotencyKey, dto.location);
  }

  @Post(':id/complete')
  @Roles(...rolesWith('job:work'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a GENERAL job (the assigned WORKER)',
    description:
      'Basic lifecycle only: IN_PROGRESS → COMPLETED. Other types are submitted and ' +
      'verified instead. Repeating it succeeds without changes.',
  })
  @IdempotencyKeyHeader()
  @ApiEnvelopeResponse(JobDetailDto, { description: 'The job, now COMPLETED.' })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    WRONG_STATUS,
  )
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: JobCommandDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.complete(user, params.id, idempotencyKey, dto.location);
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

  @Post(':id/evidence')
  @Roles(...rolesWith('job:evidence'))
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    // In memory: the file is inspected and rewritten before it is stored. One file, bounded.
    FileInterceptor('file', {
      limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1, fields: 5, parts: 7 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id', 'capturedAt', 'file'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        capturedAt: { type: 'string', format: 'date-time' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Attach a photo (the assigned WORKER)',
    description:
      'Multipart upload of one JPEG or PNG (at most 10 MB), on a job in any status. The type ' +
      'is detected from the bytes and metadata (EXIF, GPS) is removed. The evidence ID comes ' +
      'from the device: uploading the same evidence again changes nothing.',
  })
  @IdempotencyKeyHeader()
  @ApiEnvelopeResponse(JobDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The job with the photo.',
  })
  @ApiErrorResponses(
    INVALID,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      description: 'PAYLOAD_TOO_LARGE: the file is over 10 MB.',
    },
    {
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      description:
        'UNSUPPORTED_FILE_TYPE: not a JPEG or PNG, damaged, or too many pixels.',
    },
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description:
        'EVIDENCE_LIMIT_REACHED: the job has 50 photos; IDEMPOTENCY_KEY_REUSED: the ID belongs to other evidence.',
    },
  )
  addEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: AddJobEvidenceDto,
    @UploadedFile() file: UploadedEvidenceFile | undefined,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.addEvidence(user, params.id, dto, file, idempotencyKey);
  }

  @Get(':id/evidence/:evidenceId/content')
  @Header('Cache-Control', 'private, max-age=86400')
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOperation({
    summary: 'Download a photo (the assigned WORKER and staff)',
    description:
      'The stored (metadata-free) bytes. Anyone who may see the job may see its photos.',
  })
  @ApiOkResponse({ description: 'The image.' })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, NOT_FOUND)
  async evidenceContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobEvidenceParamDto,
  ): Promise<StreamableFile> {
    const content = await this.jobs.evidenceContent(
      user,
      params.id,
      params.evidenceId,
    );
    return new StreamableFile(content.data, {
      type: content.contentType,
      length: content.data.length,
      disposition: `inline; filename="${content.fileName}"`,
    });
  }

  @Post(':id/messages')
  @Roles(...rolesWith('job:message'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Post a message on a job (its WORKER and staff)',
    description:
      'Append-only, on a job in any status. The message ID comes from the sending device: ' +
      'sending the same message again changes nothing.',
  })
  @IdempotencyKeyHeader()
  @ApiEnvelopeResponse(JobDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The job with the message.',
  })
  @ApiErrorResponses(INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description:
      'IDEMPOTENCY_KEY_REUSED: the key or message ID belongs to a different request.',
  })
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: JobIdParamDto,
    @Body() dto: SendJobMessageDto,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ): Promise<JobDetailDto> {
    return this.jobs.sendMessage(user, params.id, dto, idempotencyKey);
  }

  @Post(':id/cancel')
  @Roles(...rolesWith('job:cancel'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a job (MANAGER, ORGANIZATION_ADMIN)',
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
