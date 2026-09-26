import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { JobEventType, JobStatus } from '../job-enums.js';
import type { JobCursor } from './job-cursor.js';

const userSummary = {
  select: { id: true, firstName: true, lastName: true },
} as const satisfies Prisma.UserDefaultArgs;

const summaryInclude = {
  assignedWorker: userSummary,
} as const satisfies Prisma.JobInclude;

const detailInclude = {
  assignedWorker: userSummary,
  createdBy: userSummary,
  checklistItems: { orderBy: { position: 'asc' } },
  events: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { actor: userSummary, assignee: userSummary },
  },
} as const satisfies Prisma.JobInclude;

export type JobSummaryRecord = Prisma.JobGetPayload<{
  include: typeof summaryInclude;
}>;
export type JobDetailRecord = Prisma.JobGetPayload<{
  include: typeof detailInclude;
}>;

export interface JobListFilter {
  readonly statuses?: readonly JobStatus[];
  readonly assignedWorkerId?: string;
  readonly order: 'asc' | 'desc';
  readonly cursor?: JobCursor;
  /** Page size; one extra row is read to know whether another page exists. */
  readonly limit: number;
}

export interface JobEventInput {
  readonly type: JobEventType;
  readonly fromStatus: JobStatus | null;
  readonly toStatus: JobStatus;
  readonly actorId: string;
  readonly assigneeId?: string;
}

export type JobFieldChanges = Omit<
  Prisma.JobUncheckedUpdateManyInput,
  'id' | 'version' | 'createdAt' | 'updatedAt' | 'createdById'
>;

/**
 * Owns the `jobs`, `job_checklist_items` and `job_events` tables: the only code in the API
 * that queries them (docs/backend-architecture.md, "Inside a module").
 *
 * Every change is a compare-and-set on `version`: the UPDATE only matches the row version the
 * service decided on, so two concurrent commands can never both apply (for example a worker
 * starting a job while a manager reassigns it). The loser gets `null` and reports a conflict.
 * Each change and its history event are written in one transaction.
 */
@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetail(id: string): Promise<JobDetailRecord | null> {
    return this.prisma.job.findUnique({
      where: { id },
      include: detailInclude,
    });
  }

  private findDetailOrThrow(id: string): Promise<JobDetailRecord> {
    return this.prisma.job.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    });
  }

  async list(filter: JobListFilter): Promise<{
    items: JobSummaryRecord[];
    hasMore: boolean;
  }> {
    const where: Prisma.JobWhereInput = {
      ...(filter.statuses !== undefined && {
        status: { in: [...filter.statuses] },
      }),
      ...(filter.assignedWorkerId !== undefined && {
        assignedWorkerId: filter.assignedWorkerId,
      }),
      ...(filter.cursor !== undefined && after(filter.cursor, filter.order)),
    };
    const rows = await this.prisma.job.findMany({
      where,
      include: summaryInclude,
      orderBy: [{ scheduledAt: filter.order }, { id: filter.order }],
      take: filter.limit + 1,
    });
    return {
      items: rows.slice(0, filter.limit),
      hasMore: rows.length > filter.limit,
    };
  }

  async create(
    data: Omit<
      Prisma.JobUncheckedCreateInput,
      'id' | 'status' | 'version' | 'checklistItems' | 'events'
    >,
    checklist: readonly string[],
    event: JobEventInput,
  ): Promise<JobDetailRecord> {
    // Nested creates run in a single transaction.
    const { id } = await this.prisma.job.create({
      data: {
        ...data,
        checklistItems: {
          create: checklist.map((label, position) => ({ label, position })),
        },
        events: { create: event },
      },
      select: { id: true },
    });
    return this.findDetailOrThrow(id);
  }

  /**
   * Applies field changes (and optionally a new checklist and a history event) if the job is
   * still at `expectedVersion`. Returns the updated job, or null if it changed meanwhile.
   */
  async update(
    id: string,
    expectedVersion: number,
    changes: {
      readonly fields: JobFieldChanges;
      readonly checklist?: readonly string[];
      readonly event?: JobEventInput;
    },
  ): Promise<JobDetailRecord | null> {
    const applied = await this.prisma.$transaction(async tx => {
      const { count } = await tx.job.updateMany({
        where: { id, version: expectedVersion },
        data: { ...changes.fields, version: { increment: 1 } },
      });
      if (count === 0) {
        return false;
      }
      if (changes.checklist !== undefined) {
        await tx.jobChecklistItem.deleteMany({ where: { jobId: id } });
        await tx.jobChecklistItem.createMany({
          data: changes.checklist.map((label, position) => ({
            jobId: id,
            label,
            position,
          })),
        });
      }
      if (changes.event !== undefined) {
        await tx.jobEvent.create({ data: { ...changes.event, jobId: id } });
      }
      return true;
    });
    // Read back after the commit: the multi-relation read runs its queries concurrently,
    // which a single transaction connection must not do (node-postgres deprecates it).
    // (null if a concurrent delete won the race: reported as a conflict too).
    return applied ? this.findDetail(id) : null;
  }

  /** Deletes the job if it is still PENDING at `expectedVersion`; false otherwise. */
  async deletePending(id: string, expectedVersion: number): Promise<boolean> {
    const { count } = await this.prisma.job.deleteMany({
      where: { id, version: expectedVersion, status: 'PENDING' },
    });
    return count === 1;
  }
}

/** Keyset condition: rows strictly after the cursor in (scheduledAt, id) order. */
function after(cursor: JobCursor, order: 'asc' | 'desc'): Prisma.JobWhereInput {
  const beyond = order === 'asc' ? 'gt' : 'lt';
  return {
    OR: [
      { scheduledAt: { [beyond]: cursor.scheduledAt } },
      { scheduledAt: cursor.scheduledAt, id: { [beyond]: cursor.id } },
    ],
  };
}
