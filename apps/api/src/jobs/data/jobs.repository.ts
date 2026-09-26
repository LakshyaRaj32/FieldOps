import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  type ProcessedMutation,
} from '../../generated/prisma/client.js';
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
  fieldNotes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { author: userSummary },
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

/** Commands a device may send with an Idempotency-Key. */
export type JobOperation = 'job.start' | 'job.complete' | 'job.note.add';

/** What is recorded about a processed command, in the command's own transaction. */
export interface MutationRecord {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly operation: JobOperation;
  readonly jobId: string;
  readonly responseStatus: number;
}

export interface NoteInput {
  readonly id: string;
  readonly authorId: string;
  readonly body: string;
  readonly occurredAt: Date;
}

/** The Idempotency-Key was recorded by a concurrent request first: replay that one. */
export class DuplicateMutationError extends Error {
  override readonly name = 'DuplicateMutationError';
}

/** A note with this (device-generated) ID already exists. */
export class NoteIdTakenError extends Error {
  override readonly name = 'NoteIdTakenError';
}

/** Internal: aborts a transaction whose compare-and-set lost the race. */
class StaleVersion extends Error {}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

type Tx = Prisma.TransactionClient;

/**
 * Owns the `jobs`, `job_checklist_items`, `job_events`, `job_notes` and `processed_mutations`
 * tables: the only code in the API that queries them (docs/backend-architecture.md, "Inside a
 * module").
 *
 * Every change is a compare-and-set on `version`: the UPDATE only matches the row version the
 * service decided on, so two concurrent commands can never both apply (for example a worker
 * starting a job while a manager reassigns it). The loser gets `null` and reports a conflict.
 * Each change, its history event and its idempotency record are written in one transaction.
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

  /**
   * A worker's offline working set: their open jobs, plus jobs closed since `closedSince`.
   * Served by jobs_assigned_worker_id_scheduled_at_idx.
   */
  workingSet(
    workerId: string,
    closedSince: Date,
    limit: number,
  ): Promise<JobDetailRecord[]> {
    return this.prisma.job.findMany({
      where: {
        assignedWorkerId: workerId,
        OR: [
          { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
          {
            status: { in: ['COMPLETED', 'CANCELLED'] },
            updatedAt: { gte: closedSince },
          },
        ],
      },
      include: detailInclude,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
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
   * Applies field changes (and optionally a new checklist, a history event and the command's
   * idempotency record) if the job is still at `expectedVersion`. Returns the updated job, or
   * null if it changed meanwhile.
   *
   * @throws DuplicateMutationError when a concurrent request recorded the same key first.
   */
  async update(
    id: string,
    expectedVersion: number,
    changes: {
      readonly fields: JobFieldChanges;
      readonly checklist?: readonly string[];
      readonly event?: JobEventInput;
      readonly mutation?: MutationRecord;
    },
  ): Promise<JobDetailRecord | null> {
    try {
      await this.prisma.$transaction(async tx => {
        if (changes.mutation !== undefined) {
          await insertMutation(tx, changes.mutation);
        }
        const { count } = await tx.job.updateMany({
          where: { id, version: expectedVersion },
          data: { ...changes.fields, version: { increment: 1 } },
        });
        if (count === 0) {
          // Throwing rolls back the idempotency record too.
          throw new StaleVersion();
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
      });
    } catch (error) {
      if (error instanceof StaleVersion) {
        return null;
      }
      throw error;
    }
    // Read back after the commit: the multi-relation read runs its queries concurrently,
    // which a single transaction connection must not do (node-postgres deprecates it).
    // (null if a concurrent delete won the race: reported as a conflict too).
    return this.findDetail(id);
  }

  /**
   * Appends a field note (and the command's idempotency record) in one transaction. Notes are
   * a child collection: they do not change the job's `version`, so a note never conflicts
   * with a manager's edit.
   *
   * @throws DuplicateMutationError when a concurrent request recorded the same key first.
   * @throws NoteIdTakenError when a note with this ID already exists.
   */
  async addNote(
    jobId: string,
    note: NoteInput,
    mutation?: MutationRecord,
  ): Promise<JobDetailRecord> {
    await this.prisma.$transaction(async tx => {
      if (mutation !== undefined) {
        await insertMutation(tx, mutation);
      }
      try {
        await tx.jobNote.create({ data: { ...note, jobId } });
      } catch (error) {
        throw isUniqueViolation(error) ? new NoteIdTakenError() : error;
      }
    });
    return this.findDetailOrThrow(jobId);
  }

  findNote(id: string): Promise<{ jobId: string; authorId: string } | null> {
    return this.prisma.jobNote.findUnique({
      where: { id },
      select: { jobId: true, authorId: true },
    });
  }

  findMutation(
    userId: string,
    idempotencyKey: string,
  ): Promise<ProcessedMutation | null> {
    return this.prisma.processedMutation.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  /**
   * Records a command that succeeded without writing anything (it was already applied), so a
   * retry of it is recognized later too.
   *
   * @throws DuplicateMutationError when the key is already recorded.
   */
  async recordMutation(mutation: MutationRecord): Promise<void> {
    await this.prisma.$transaction(tx => insertMutation(tx, mutation));
  }

  /** Deletes the job if it is still PENDING at `expectedVersion`; false otherwise. */
  async deletePending(id: string, expectedVersion: number): Promise<boolean> {
    const { count } = await this.prisma.job.deleteMany({
      where: { id, version: expectedVersion, status: 'PENDING' },
    });
    return count === 1;
  }
}

/**
 * Inserted first in its transaction, so a unique violation here can only mean "this key was
 * already processed", never a constraint of the domain change.
 */
async function insertMutation(tx: Tx, mutation: MutationRecord): Promise<void> {
  try {
    await tx.processedMutation.create({ data: mutation });
  } catch (error) {
    throw isUniqueViolation(error) ? new DuplicateMutationError() : error;
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
