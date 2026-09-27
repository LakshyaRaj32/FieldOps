import { Injectable } from '@nestjs/common';

import { writeAudit, type AuditRecord } from '../audit/audit.js';
import { AuthErrors } from '../common/errors/app-exception.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  Prisma,
  type Organization,
  type User,
} from '../generated/prisma/client.js';
import { Role } from './role.js';

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Defaults to WORKER. */
  readonly role?: Role;
  /** Defaults to none (self-registration, SUPER_ADMIN). */
  readonly organizationId?: string | null;
  readonly organizationWideAccess?: boolean;
}

export type UserWithOrganization = User & {
  organization: Organization | null;
};

const withOrganization = {
  organization: true,
} as const satisfies Prisma.UserInclude;

/** A member with their current manager (workers in a team). */
const memberInclude = {
  teamManagers: {
    where: { endedAt: null },
    take: 1,
    include: {
      manager: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const satisfies Prisma.UserInclude;

export type MemberRecord = Prisma.UserGetPayload<{
  include: typeof memberInclude;
}>;

export interface MemberChanges {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly role?: Role;
  readonly isActive?: boolean;
  readonly organizationWideAccess?: boolean;
}

type Tx = Prisma.TransactionClient;

/** Normalizes an email for storage and lookup: the unique index relies on this. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/**
 * Owns the `users` and `team_memberships` tables. Other modules go through this service,
 * never through Prisma directly (docs/backend-architecture.md, "Inside a module"); the read
 * side of teams used for scope checks is AccessService.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<UserWithOrganization | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: withOrganization,
    });
  }

  findByEmail(email: string): Promise<UserWithOrganization | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: withOrganization,
    });
  }

  /**
   * Creates a user. Self-registration never chooses a role or an organization (the defaults:
   * an unaffiliated WORKER); administrators create members with both.
   *
   * Uniqueness is enforced by the database, not by a prior lookup, so two concurrent
   * registrations with the same email cannot both succeed.
   */
  async create(
    input: CreateUserInput,
    options: { readonly tx?: Tx; readonly audit?: AuditRecordFor } = {},
  ): Promise<UserWithOrganization> {
    const run = async (tx: Tx): Promise<UserWithOrganization> => {
      const user = await tx.user.create({
        data: {
          email: normalizeEmail(input.email),
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role ?? Role.WORKER,
          organizationId: input.organizationId ?? null,
          organizationWideAccess: input.organizationWideAccess ?? false,
        },
        include: withOrganization,
      });
      if (options.audit !== undefined) {
        await writeAudit(tx, options.audit(user));
      }
      return user;
    };
    try {
      return options.tx === undefined
        ? await this.prisma.$transaction(run)
        : await run(options.tx);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AuthErrors.emailAlreadyRegistered();
      }
      throw error;
    }
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    audit?: AuditRecord,
  ): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      if (audit !== undefined) {
        await writeAudit(tx, audit);
      }
    });
  }

  /** Active workers of the organization (optionally only `workerIds`), by name. */
  listActiveWorkers(
    organizationId: string,
    workerIds: readonly string[] | undefined,
    limit: number,
  ): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        role: Role.WORKER,
        isActive: true,
        ...(workerIds !== undefined && { id: { in: [...workerIds] } }),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  /** The organization's people, newest first (optionally one role). */
  listMembers(
    organizationId: string,
    options: { readonly role?: Role; readonly limit: number },
  ): Promise<MemberRecord[]> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        ...(options.role !== undefined && { role: options.role }),
      },
      include: memberInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: options.limit,
    });
  }

  /** A member of this organization, or null (someone else's member is "not found"). */
  findMember(organizationId: string, id: string): Promise<MemberRecord | null> {
    return this.prisma.user.findFirst({
      where: { id, organizationId },
      include: memberInclude,
    });
  }

  /**
   * Applies member changes in one transaction with their audit entry. Moving someone out of
   * the WORKER role ends their team membership; out of MANAGER ends their team (the workers
   * become teamless) and any organization-wide grant.
   */
  async updateMember(
    organizationId: string,
    id: string,
    changes: MemberChanges,
    audit: AuditRecord,
  ): Promise<MemberRecord> {
    await this.prisma.$transaction(async tx => {
      const now = new Date();
      const current = await tx.user.findFirstOrThrow({
        where: { id, organizationId },
      });
      const role = changes.role ?? current.role;
      if (current.role === Role.WORKER && role !== Role.WORKER) {
        await tx.teamMembership.updateMany({
          where: { workerId: id, endedAt: null },
          data: { endedAt: now },
        });
      }
      if (current.role === Role.MANAGER && role !== Role.MANAGER) {
        await tx.teamMembership.updateMany({
          where: { managerId: id, endedAt: null },
          data: { endedAt: now },
        });
      }
      await tx.user.update({
        where: { id },
        data: {
          ...(changes.firstName !== undefined && {
            firstName: changes.firstName,
          }),
          ...(changes.lastName !== undefined && { lastName: changes.lastName }),
          ...(changes.isActive !== undefined && { isActive: changes.isActive }),
          role,
          organizationWideAccess:
            role === Role.MANAGER
              ? (changes.organizationWideAccess ??
                current.organizationWideAccess)
              : false,
        },
      });
      await writeAudit(tx, audit);
    });
    const member = await this.findMember(organizationId, id);
    if (member === null) {
      throw new Error('Member vanished after update');
    }
    return member;
  }

  /**
   * Moves a worker into `managerId`'s team, or out of every team (null). The current
   * membership is ended, never edited, so the history of who managed whom stays. The
   * partial unique index guarantees one current team per worker even under concurrency.
   */
  async setManager(
    organizationId: string,
    workerId: string,
    managerId: string | null,
    audit: (previousManagerId: string | null) => AuditRecord | undefined,
    tx?: Tx,
  ): Promise<void> {
    const run = async (client: Tx): Promise<void> => {
      const now = new Date();
      const current = await client.teamMembership.findFirst({
        where: { workerId, endedAt: null },
      });
      if (current?.managerId === managerId) {
        return;
      }
      if (current !== null) {
        await client.teamMembership.update({
          where: { id: current.id },
          data: { endedAt: now },
        });
      }
      if (managerId !== null) {
        await client.teamMembership.create({
          data: { organizationId, managerId, workerId, startedAt: now },
        });
      }
      const record = audit(current?.managerId ?? null);
      if (record !== undefined) {
        await writeAudit(client, record);
      }
    };
    await (tx === undefined ? this.prisma.$transaction(run) : run(tx));
  }

  /** Runs `work` in one transaction (member creation with its team). */
  transaction<Result>(work: (tx: Tx) => Promise<Result>): Promise<Result> {
    return this.prisma.$transaction(work);
  }
}

/** Builds the audit entry for a user once the row (and its ID) exists. */
export type AuditRecordFor = (user: User) => AuditRecord;
