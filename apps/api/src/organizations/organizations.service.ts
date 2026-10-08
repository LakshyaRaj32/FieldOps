import { Injectable } from '@nestjs/common';

import { changesOf, writeAudit, type AuditRecord } from '../audit/audit.js';
import { PasswordService } from '../auth/password.service.js';
import { CacheKeys } from '../cache/cache-keys.js';
import { CacheService } from '../cache/cache.service.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { orgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Organization } from '../generated/prisma/client.js';
import { Role } from '../users/role.js';
import { UsersService } from '../users/users.service.js';
import {
  OrganizationDto,
  type CreateOrganizationDto,
  type NewAccountDto,
  type UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { MemberDto } from '../users/dto/member.dto.js';

/** Whether a runtime (Intl) knows the time zone; the regex in the DTO only checks shape. */
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function isKnownCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency });
    return true;
  } catch {
    return false;
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/**
 * Owns the `organizations` table: the platform's tenants.
 *
 * - SUPER_ADMINs create, list, update, suspend and reactivate organizations and create their
 *   administrators. They do no field operations (every business endpoint refuses callers
 *   outside an organization).
 * - Members read their own organization; its ORGANIZATION_ADMINs change its settings.
 *
 * Suspension takes effect on the next request of every member (AccessTokenVerifier checks
 * the status on each one) and blocks sign-in; nothing is deleted.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly cache: CacheService,
  ) {}

  async list(): Promise<OrganizationDto[]> {
    const rows = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return rows.map(row => OrganizationDto.from(row, row._count.users));
  }

  async get(id: string): Promise<OrganizationDto> {
    return this.toDto(await this.load(id));
  }

  /** The caller's own organization (any member). */
  async getOwn(user: AuthenticatedUser): Promise<OrganizationDto> {
    return this.get(orgScope(user).organizationId);
  }

  async create(
    superAdmin: AuthenticatedUser,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationDto> {
    this.checkSettings(dto);
    const adminHash =
      dto.admin === undefined
        ? undefined
        : await this.passwords.hash(dto.admin.password);
    try {
      const organization = await this.prisma.$transaction(async tx => {
        const created = await tx.organization.create({
          data: {
            name: dto.name,
            contactName: dto.contactName ?? null,
            contactEmail: dto.contactEmail ?? null,
            contactPhone: dto.contactPhone ?? null,
            address: dto.address ?? null,
            ...(dto.currency !== undefined && { currency: dto.currency }),
            ...(dto.timeZone !== undefined && { timeZone: dto.timeZone }),
            ...(dto.arrivalRadiusMeters !== undefined && {
              arrivalRadiusMeters: dto.arrivalRadiusMeters,
            }),
          },
        });
        await writeAudit(tx, {
          organizationId: created.id,
          actorId: superAdmin.userId,
          action: 'organization.created',
          entityType: 'organization',
          entityId: created.id,
          summary: `Organization ${created.name} created`,
        });
        if (dto.admin !== undefined && adminHash !== undefined) {
          await this.createAdminIn(
            tx,
            created,
            dto.admin,
            adminHash,
            superAdmin,
          );
        }
        return created;
      });
      return this.toDto(organization);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw BusinessErrors.alreadyExists(
          'name',
          'An organization with this name already exists.',
        );
      }
      throw error;
    }
  }

  /** SUPER_ADMIN: creates an ORGANIZATION_ADMIN account in the organization. */
  async createAdmin(
    superAdmin: AuthenticatedUser,
    organizationId: string,
    account: NewAccountDto,
  ): Promise<MemberDto> {
    const organization = await this.load(organizationId);
    const hash = await this.passwords.hash(account.password);
    const id = await this.prisma.$transaction(tx =>
      this.createAdminIn(tx, organization, account, hash, superAdmin),
    );
    const member = await this.users.findMember(organizationId, id);
    if (member === null) {
      throw new Error('Admin vanished after creation');
    }
    return MemberDto.from(member);
  }

  /** SUPER_ADMIN edits any organization; an ORGANIZATION_ADMIN edits only their own. */
  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    this.checkSettings(dto);
    await this.load(id);
    try {
      const updated = await this.prisma.$transaction(async tx => {
        const row = await tx.organization.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.contactName !== undefined && {
              contactName: dto.contactName,
            }),
            ...(dto.contactEmail !== undefined && {
              contactEmail: dto.contactEmail,
            }),
            ...(dto.contactPhone !== undefined && {
              contactPhone: dto.contactPhone,
            }),
            ...(dto.address !== undefined && { address: dto.address }),
            ...(dto.timeZone !== undefined && { timeZone: dto.timeZone }),
            ...(dto.arrivalRadiusMeters !== undefined && {
              arrivalRadiusMeters: dto.arrivalRadiusMeters,
            }),
          },
        });
        await writeAudit(tx, {
          organizationId: id,
          actorId: actor.userId,
          action: 'organization.updated',
          entityType: 'organization',
          entityId: id,
          summary: `Organization ${row.name} updated`,
          data: { changes: changesOf(dto) },
        });
        return row;
      });
      // After the commit, so a concurrent reader cannot cache the old time zone again.
      await this.cache.invalidate(CacheKeys.organizationMoney(id));
      return this.toDto(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw BusinessErrors.alreadyExists(
          'name',
          'An organization with this name already exists.',
        );
      }
      throw error;
    }
  }

  updateOwn(
    admin: AuthenticatedUser,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.update(admin, orgScope(admin).organizationId, dto);
  }

  /** Suspends (true) or reactivates (false). Repeating either is a no-op. */
  async setSuspended(
    superAdmin: AuthenticatedUser,
    id: string,
    suspended: boolean,
  ): Promise<OrganizationDto> {
    const current = await this.load(id);
    if ((current.status === 'SUSPENDED') === suspended) {
      return this.toDto(current);
    }
    const updated = await this.prisma.$transaction(async tx => {
      const row = await tx.organization.update({
        where: { id },
        data: suspended
          ? { status: 'SUSPENDED', suspendedAt: new Date() }
          : { status: 'ACTIVE', suspendedAt: null },
      });
      const audit: AuditRecord = {
        organizationId: id,
        actorId: superAdmin.userId,
        action: suspended ? 'organization.suspended' : 'organization.activated',
        entityType: 'organization',
        entityId: id,
        summary: `Organization ${row.name} ${suspended ? 'suspended' : 'reactivated'}`,
      };
      await writeAudit(tx, audit);
      return row;
    });
    return this.toDto(updated);
  }

  /** The arrival radius and time zone of an organization (operations need them). */
  async settings(
    organizationId: string,
  ): Promise<
    Pick<Organization, 'currency' | 'timeZone' | 'arrivalRadiusMeters'>
  > {
    return this.load(organizationId);
  }

  private async createAdminIn(
    tx: Prisma.TransactionClient,
    organization: Organization,
    account: NewAccountDto,
    passwordHash: string,
    superAdmin: AuthenticatedUser,
  ): Promise<string> {
    const user = await this.users.create(
      {
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        role: Role.ORGANIZATION_ADMIN,
        organizationId: organization.id,
      },
      {
        tx,
        audit: row => ({
          organizationId: organization.id,
          actorId: superAdmin.userId,
          action: 'member.created',
          entityType: 'user',
          entityId: row.id,
          summary: `${row.firstName} ${row.lastName} added as ORGANIZATION_ADMIN`,
          data: { role: row.role, email: row.email },
        }),
      },
    );
    return user.id;
  }

  private checkSettings(dto: {
    readonly currency?: string;
    readonly timeZone?: string;
  }): void {
    if (dto.timeZone !== undefined && !isKnownTimeZone(dto.timeZone)) {
      throw BusinessErrors.invalid('timeZone', 'Unknown time zone.');
    }
    if (dto.currency !== undefined && !isKnownCurrency(dto.currency)) {
      throw BusinessErrors.invalid('currency', 'Unknown currency code.');
    }
  }

  private async load(id: string): Promise<Organization> {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    if (row === null) {
      throw BusinessErrors.notFound('Organization');
    }
    return row;
  }

  private async toDto(row: Organization): Promise<OrganizationDto> {
    const members = await this.prisma.user.count({
      where: { organizationId: row.id },
    });
    return OrganizationDto.from(row, members);
  }
}
