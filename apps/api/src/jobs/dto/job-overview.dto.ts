import { ApiProperty } from '@nestjs/swagger';
import type { JobActivity, JobOverview, WorkerWorkload } from '@fieldops/types';

import type { OverviewRecord } from '../data/jobs.repository.js';
import { statusCounts, workload } from '../domain/job-overview.js';
import { JobEventType, JobStatus } from '../job-enums.js';
import { UserSummaryDto } from './job-response.dto.js';

export class JobStatusCountsDto implements Record<JobStatus, number> {
  @ApiProperty({ example: 3 })
  readonly PENDING: number;

  @ApiProperty({ example: 5 })
  readonly ASSIGNED: number;

  @ApiProperty({ example: 2 })
  readonly IN_PROGRESS: number;

  @ApiProperty({ example: 41 })
  readonly COMPLETED: number;

  @ApiProperty({ example: 4 })
  readonly CANCELLED: number;
}

export class WorkerWorkloadDto implements WorkerWorkload {
  @ApiProperty({ type: UserSummaryDto })
  readonly worker: UserSummaryDto;

  @ApiProperty({ example: 2, description: 'Assigned and not started yet.' })
  readonly assigned: number;

  @ApiProperty({ example: 1 })
  readonly inProgress: number;
}

export class JobActivityDto implements JobActivity {
  @ApiProperty({ format: 'uuid' })
  readonly id: string;

  @ApiProperty({ format: 'uuid' })
  readonly jobId: string;

  @ApiProperty({ example: 'AC repair' })
  readonly jobTitle: string;

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

export class JobOverviewDto implements JobOverview {
  @ApiProperty({
    type: JobStatusCountsDto,
    description: 'Every job by its current status.',
  })
  readonly statusCounts: JobStatusCountsDto;

  @ApiProperty({
    example: 1,
    description:
      'Open jobs (PENDING, ASSIGNED, IN_PROGRESS) whose scheduled time has passed.',
  })
  readonly overdue: number;

  @ApiProperty({
    example: 4,
    description: 'Open jobs scheduled within the next 24 hours.',
  })
  readonly dueNext24Hours: number;

  @ApiProperty({ example: 12, description: 'Completed in the last 7 days.' })
  readonly completedLast7Days: number;

  @ApiProperty({ example: 1, description: 'Cancelled in the last 7 days.' })
  readonly cancelledLast7Days: number;

  @ApiProperty({
    type: [WorkerWorkloadDto],
    description: 'Workers with open jobs, busiest first (at most 10).',
  })
  readonly workload: WorkerWorkloadDto[];

  @ApiProperty({
    type: [JobActivityDto],
    description:
      'Latest history entries across all jobs, newest first (at most 10).',
  })
  readonly recentActivity: JobActivityDto[];

  @ApiProperty({ format: 'date-time' })
  readonly generatedAt: string;

  static from(record: OverviewRecord, generatedAt: Date): JobOverviewDto {
    return Object.assign(new JobOverviewDto(), {
      statusCounts: Object.assign(
        new JobStatusCountsDto(),
        statusCounts(record.byStatus),
      ),
      overdue: record.overdue,
      dueNext24Hours: record.dueNext24Hours,
      completedLast7Days: record.completedLast7Days,
      cancelledLast7Days: record.cancelledLast7Days,
      workload: workload(record.byWorker, record.workers).map(entry => ({
        worker: UserSummaryDto.from(entry.worker),
        assigned: entry.assigned,
        inProgress: entry.inProgress,
      })),
      recentActivity: record.recentActivity.map(event => ({
        id: event.id,
        jobId: event.jobId,
        jobTitle: event.job.title,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actor: UserSummaryDto.from(event.actor),
        assignee:
          event.assignee === null ? null : UserSummaryDto.from(event.assignee),
        createdAt: event.createdAt.toISOString(),
      })),
      generatedAt: generatedAt.toISOString(),
    });
  }
}
