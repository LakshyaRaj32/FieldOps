import { ApiProperty } from '@nestjs/swagger';
import type {
  JobChecklistItem,
  JobDetail,
  JobHistoryEntry,
  JobPage,
  JobSummary,
  UserSummary,
} from '@fieldops/types';

import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import type {
  JobDetailRecord,
  JobSummaryRecord,
} from '../data/jobs.repository.js';
import { allowedActions } from '../domain/job.policy.js';
import {
  JobAction,
  JobEventType,
  JobPriority,
  JobStatus,
} from '../job-enums.js';
import { GeoPointDto } from './job-fields.js';

type UserRow = { id: string; firstName: string; lastName: string };

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export class UserSummaryDto implements UserSummary {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'Asha' })
  readonly firstName: string;

  @ApiProperty({ example: 'Verma' })
  readonly lastName: string;

  static from(user: UserRow): UserSummaryDto {
    return Object.assign(new UserSummaryDto(), {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }
}

export class JobChecklistItemDto implements JobChecklistItem {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 0 })
  readonly position: number;

  @ApiProperty({ example: 'Clean filters' })
  readonly label: string;
}

export class JobSummaryDto implements JobSummary {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ example: 'AC repair' })
  readonly title: string;

  @ApiProperty({ example: 'ABC Ltd' })
  readonly customerName: string;

  @ApiProperty({ example: '12 MG Road, Bengaluru 560001' })
  readonly address: string;

  @ApiProperty({ format: 'date-time' })
  readonly scheduledAt: string;

  @ApiProperty({ enum: Object.values(JobPriority) })
  readonly priority: JobPriority;

  @ApiProperty({ enum: Object.values(JobStatus) })
  readonly status: JobStatus;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly assignedWorker: UserSummaryDto | null;

  @ApiProperty({
    example: 2,
    description: 'Send back with PATCH (optimistic concurrency).',
  })
  readonly version: number;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt: string;

  @ApiProperty({
    enum: Object.values(JobAction),
    isArray: true,
    example: ['start'],
    description:
      'What the signed-in user may do with this job right now. Clients show exactly these.',
  })
  readonly allowedActions: JobAction[];

  static from(job: JobSummaryRecord, user: AuthenticatedUser): JobSummaryDto {
    return Object.assign(new JobSummaryDto(), summaryFields(job, user));
  }
}

function summaryFields(
  job: JobSummaryRecord,
  user: AuthenticatedUser,
): JobSummary {
  return {
    id: job.id,
    title: job.title,
    customerName: job.customerName,
    address: job.address,
    scheduledAt: job.scheduledAt.toISOString(),
    priority: job.priority,
    status: job.status,
    assignedWorker:
      job.assignedWorker === null
        ? null
        : UserSummaryDto.from(job.assignedWorker),
    version: job.version,
    updatedAt: job.updatedAt.toISOString(),
    allowedActions: allowedActions(user, job),
  };
}

export class JobHistoryEntryDto implements JobHistoryEntry {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ enum: Object.values(JobEventType) })
  readonly type: JobEventType;

  @ApiProperty({ enum: Object.values(JobStatus), nullable: true })
  readonly fromStatus: JobStatus | null;

  @ApiProperty({ enum: Object.values(JobStatus) })
  readonly toStatus: JobStatus;

  @ApiProperty({ type: UserSummaryDto })
  readonly actor: UserSummaryDto;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly assignee: UserSummaryDto | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;
}

export class JobDetailDto extends JobSummaryDto implements JobDetail {
  @ApiProperty({ type: String, nullable: true })
  readonly description: string | null;

  @ApiProperty({ type: GeoPointDto, nullable: true })
  readonly location: GeoPointDto | null;

  @ApiProperty({ type: String, nullable: true })
  readonly notes: string | null;

  @ApiProperty({ type: [JobChecklistItemDto] })
  readonly checklist: JobChecklistItemDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly cancellationReason: string | null;

  @ApiProperty({ type: UserSummaryDto })
  readonly createdBy: UserSummaryDto;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly startedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly completedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly cancelledAt: string | null;

  @ApiProperty({ type: [JobHistoryEntryDto], description: 'Oldest first.' })
  readonly history: JobHistoryEntryDto[];

  static override from(
    job: JobDetailRecord,
    user: AuthenticatedUser,
  ): JobDetailDto {
    return Object.assign(new JobDetailDto(), {
      ...summaryFields(job, user),
      description: job.description,
      location:
        job.latitude === null || job.longitude === null
          ? null
          : { latitude: job.latitude, longitude: job.longitude },
      notes: job.notes,
      checklist: job.checklistItems.map(item => ({
        id: item.id,
        position: item.position,
        label: item.label,
      })),
      cancellationReason: job.cancellationReason,
      createdBy: UserSummaryDto.from(job.createdBy),
      createdAt: job.createdAt.toISOString(),
      startedAt: iso(job.startedAt),
      completedAt: iso(job.completedAt),
      cancelledAt: iso(job.cancelledAt),
      history: job.events.map(event => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actor: UserSummaryDto.from(event.actor),
        assignee:
          event.assignee === null ? null : UserSummaryDto.from(event.assignee),
        createdAt: event.createdAt.toISOString(),
      })),
    } satisfies JobDetail);
  }
}

export class JobPageDto implements JobPage {
  @ApiProperty({ type: [JobSummaryDto] })
  readonly items: JobSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` for the next page; null on the last page.',
  })
  readonly nextCursor: string | null;
}
