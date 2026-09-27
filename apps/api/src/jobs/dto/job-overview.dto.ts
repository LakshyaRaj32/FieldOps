import { ApiProperty } from '@nestjs/swagger';
import type {
  CollectionFigures,
  JobActivity,
  JobOverview,
  ShopFigures,
  WorkerFigures,
  WorkerWorkload,
} from '@fieldops/types';

import { UserSummaryDto } from '../../common/dto/user-summary.dto.js';
import type { OverviewRecord } from '../data/jobs.repository.js';
import { statusCounts, workload } from '../domain/job-overview.js';
import { JobEventType, JobStatus } from '../job-enums.js';

export class JobStatusCountsDto implements Record<JobStatus, number> {
  @ApiProperty({ example: 3 }) readonly PENDING: number;
  @ApiProperty({ example: 5 }) readonly ASSIGNED: number;
  @ApiProperty({ example: 2 }) readonly ACCEPTED: number;
  @ApiProperty({ example: 1 }) readonly EN_ROUTE: number;
  @ApiProperty({ example: 1 }) readonly ARRIVED: number;
  @ApiProperty({ example: 2 }) readonly IN_PROGRESS: number;
  @ApiProperty({ example: 3 }) readonly SUBMITTED: number;
  @ApiProperty({ example: 41 }) readonly COMPLETED: number;
  @ApiProperty({ example: 4 }) readonly CANCELLED: number;
  @ApiProperty({ example: 1 }) readonly FAILED: number;
}

export class WorkerWorkloadDto implements WorkerWorkload {
  @ApiProperty({ type: UserSummaryDto })
  readonly worker: UserSummaryDto;

  @ApiProperty({
    example: 2,
    description: 'Assigned or accepted, not under way.',
  })
  readonly assigned: number;

  @ApiProperty({ example: 1, description: 'En route, arrived or in progress.' })
  readonly inProgress: number;
}

export class WorkerFiguresDto implements WorkerFigures {
  @ApiProperty() readonly total: number;
  @ApiProperty() readonly busy: number;
  @ApiProperty() readonly available: number;
  @ApiProperty({ description: 'Connected to live updates right now.' })
  readonly online: number;
}

export class CollectionFiguresDto implements CollectionFigures {
  @ApiProperty({ example: 'INR' }) readonly currency: string;
  @ApiProperty() readonly outstanding: number;
  @ApiProperty() readonly dueToday: number;
  @ApiProperty() readonly overdue: number;
  @ApiProperty() readonly collectedToday: number;
  @ApiProperty() readonly pendingVerification: number;
}

export class ShopFiguresDto implements ShopFigures {
  @ApiProperty() readonly total: number;
  @ApiProperty() readonly visitedToday: number;
  @ApiProperty() readonly pendingVisits: number;
}

export class JobActivityDto implements JobActivity {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ format: 'uuid' }) readonly jobId: string;
  @ApiProperty({ example: 'Collect September dues' }) readonly jobTitle: string;
  @ApiProperty({ enum: Object.values(JobEventType) })
  readonly type: JobEventType;
  @ApiProperty({ enum: Object.values(JobStatus), nullable: true })
  readonly fromStatus: JobStatus | null;
  @ApiProperty({ enum: Object.values(JobStatus) })
  readonly toStatus: JobStatus;
  @ApiProperty({ type: UserSummaryDto }) readonly actor: UserSummaryDto;
  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly assignee: UserSummaryDto | null;
  @ApiProperty({ type: String, nullable: true }) readonly reason: string | null;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
}

/** The parts of the overview computed outside the operations tables. */
export interface OverviewExtras {
  readonly scope: 'organization' | 'team';
  readonly workers: WorkerFigures;
  readonly collections: CollectionFigures;
  readonly shops: ShopFigures;
}

export class JobOverviewDto implements JobOverview {
  @ApiProperty({ enum: ['organization', 'team'] })
  readonly scope: 'organization' | 'team';

  @ApiProperty({
    type: JobStatusCountsDto,
    description: 'Every operation in scope by its current status.',
  })
  readonly statusCounts: JobStatusCountsDto;

  @ApiProperty({ description: 'Open operations whose due time has passed.' })
  readonly overdue: number;

  @ApiProperty({ description: 'Open operations due within the next 24 hours.' })
  readonly dueNext24Hours: number;

  @ApiProperty({ description: 'Submitted results waiting for verification.' })
  readonly awaitingVerification: number;

  @ApiProperty({ description: 'Completed in the last 7 days.' })
  readonly completedLast7Days: number;

  @ApiProperty({ description: 'Cancelled in the last 7 days.' })
  readonly cancelledLast7Days: number;

  @ApiProperty({ description: 'Failed in the last 7 days.' })
  readonly failedLast7Days: number;

  @ApiProperty({ type: WorkerFiguresDto }) readonly workers: WorkerFiguresDto;
  @ApiProperty({ type: CollectionFiguresDto })
  readonly collections: CollectionFiguresDto;
  @ApiProperty({ type: ShopFiguresDto }) readonly shops: ShopFiguresDto;

  @ApiProperty({
    type: [WorkerWorkloadDto],
    description: 'Workers with open operations, busiest first (at most 10).',
  })
  readonly workload: WorkerWorkloadDto[];

  @ApiProperty({
    type: [JobActivityDto],
    description: 'Latest history entries in scope, newest first (at most 10).',
  })
  readonly recentActivity: JobActivityDto[];

  @ApiProperty({ format: 'date-time' })
  readonly generatedAt: string;

  static from(
    record: OverviewRecord,
    extras: OverviewExtras,
    generatedAt: Date,
  ): JobOverviewDto {
    const counts = statusCounts(record.byStatus);
    return Object.assign(new JobOverviewDto(), {
      scope: extras.scope,
      statusCounts: Object.assign(new JobStatusCountsDto(), counts),
      overdue: record.overdue,
      dueNext24Hours: record.dueNext24Hours,
      awaitingVerification: counts.SUBMITTED,
      completedLast7Days: record.completedLast7Days,
      cancelledLast7Days: record.cancelledLast7Days,
      failedLast7Days: record.failedLast7Days,
      workers: extras.workers,
      collections: extras.collections,
      shops: extras.shops,
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
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
      })),
      generatedAt: generatedAt.toISOString(),
    } satisfies JobOverview);
  }
}
