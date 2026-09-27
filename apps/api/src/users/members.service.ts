import { Injectable } from '@nestjs/common';

import { changesOf, type AuditRecord } from '../audit/audit.js';
import { PasswordService } from '../auth/password.service.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { orgScope, type OrgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import type {
  CreateMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
} from './dto/member.dto.js';
import { MemberDto } from './dto/member.dto.js';
import { Role } from './role.js';
import { UsersService, type MemberRecord } from './users.service.js';

const DEFAULT_LIMIT = 200;

const fullName = (user: { firstName: string; lastName: string }): string =>
  `${user.firstName} ${user.lastName}`;

/**
 * Organization membership, run by ORGANIZATION_ADMINs: creating accounts for managers,
 * workers and other admins, changing roles, deactivating, and moving workers between teams.
 * Every change is audited in its own transaction.
 *
 * The organization is always the admin's own (orgScope); a member of another organization
 * is "not found".
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async list(
    admin: AuthenticatedUser,
    query: ListMembersQueryDto,
  ): Promise<MemberDto[]> {
    const scope = orgScope(admin);
    const rows = await this.users.listMembers(scope.organizationId, {
      ...(query.role !== undefined && { role: query.role }),
      limit: query.limit ?? DEFAULT_LIMIT,
    });
    return rows.map(row => MemberDto.from(row));
  }

  async get(admin: AuthenticatedUser, id: string): Promise<MemberDto> {
    const scope = orgScope(admin);
    return MemberDto.from(await this.loadMember(scope, id));
  }

  async create(
    admin: AuthenticatedUser,
    dto: CreateMemberDto,
  ): Promise<MemberDto> {
    const scope = orgScope(admin);
    if (dto.organizationWideAccess === true && dto.role !== Role.MANAGER) {
      throw BusinessErrors.invalid(
        'organizationWideAccess',
        'Only managers can be given organization-wide access.',
      );
    }
    if (dto.managerId !== undefined) {
      if (dto.role !== Role.WORKER) {
        throw BusinessErrors.invalid(
          'managerId',
          'Only workers belong to a manager’s team.',
        );
      }
      await this.loadTeamManager(scope, dto.managerId);
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.transaction(async tx => {
      const created = await this.users.create(
        {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          organizationId: scope.organizationId,
          organizationWideAccess: dto.organizationWideAccess ?? false,
        },
        {
          tx,
          audit: row => ({
            organizationId: scope.organizationId,
            actorId: scope.userId,
            action: 'member.created',
            entityType: 'user',
            entityId: row.id,
            summary: `${fullName(row)} added as ${row.role}`,
            data: { role: row.role, email: row.email },
          }),
        },
      );
      if (dto.managerId !== undefined) {
        await this.users.setManager(
          scope.organizationId,
          created.id,
          dto.managerId,
          () => this.teamAudit(scope, created.id, dto.managerId ?? null),
          tx,
        );
      }
      return created;
    });
    return MemberDto.from(await this.loadMember(scope, user.id));
  }

  async update(
    admin: AuthenticatedUser,
    id: string,
    dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    const scope = orgScope(admin);
    const member = await this.loadMember(scope, id);
    if (
      id === scope.userId &&
      ((dto.role !== undefined && dto.role !== member.role) ||
        dto.isActive === false)
    ) {
      // An organization must never lock out the admin making the change.
      throw BusinessErrors.conflict(
        "You can't change your own role or deactivate your own account.",
      );
    }
    const role = dto.role ?? member.role;
    if (dto.organizationWideAccess === true && role !== Role.MANAGER) {
      throw BusinessErrors.invalid(
        'organizationWideAccess',
        'Only managers can be given organization-wide access.',
      );
    }

    const deactivating = dto.isActive === false && member.isActive;
    const audit: AuditRecord = {
      organizationId: scope.organizationId,
      actorId: scope.userId,
      action: deactivating ? 'member.deactivated' : 'member.updated',
      entityType: 'user',
      entityId: id,
      summary: deactivating
        ? `${fullName(member)} deactivated`
        : `${fullName(member)} updated`,
      data: { changes: changesOf(dto) },
    };
    const updated = await this.users.updateMember(
      scope.organizationId,
      id,
      {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.organizationWideAccess !== undefined && {
          organizationWideAccess: dto.organizationWideAccess,
        }),
      },
      audit,
    );
    return MemberDto.from(updated);
  }

  /** Moves a worker into a manager's team (or out of every team with null). */
  async setManager(
    admin: AuthenticatedUser,
    workerId: string,
    managerId: string | null,
  ): Promise<MemberDto> {
    const scope = orgScope(admin);
    const worker = await this.loadMember(scope, workerId);
    if (worker.role !== Role.WORKER) {
      throw BusinessErrors.invalidReference(
        'workerId',
        'Only workers belong to a manager’s team.',
      );
    }
    if (managerId !== null) {
      await this.loadTeamManager(scope, managerId);
    }
    await this.users.setManager(
      scope.organizationId,
      workerId,
      managerId,
      previous =>
        previous === managerId
          ? undefined
          : this.teamAudit(scope, workerId, managerId),
    );
    return MemberDto.from(await this.loadMember(scope, workerId));
  }

  private teamAudit(
    scope: OrgScope,
    workerId: string,
    managerId: string | null,
  ): AuditRecord {
    return {
      organizationId: scope.organizationId,
      actorId: scope.userId,
      action:
        managerId === null ? 'team.worker_removed' : 'team.worker_assigned',
      entityType: 'user',
      entityId: workerId,
      summary:
        managerId === null
          ? 'Worker removed from their team'
          : 'Worker moved to a new team',
      data: { managerId },
    };
  }

  private async loadMember(scope: OrgScope, id: string): Promise<MemberRecord> {
    const member = await this.users.findMember(scope.organizationId, id);
    if (member === null) {
      throw BusinessErrors.notFound('Member');
    }
    return member;
  }

  /** A manager of this organization who can lead a team. */
  private async loadTeamManager(scope: OrgScope, id: string): Promise<void> {
    const manager = await this.users.findMember(scope.organizationId, id);
    if (
      manager === null ||
      manager.role !== Role.MANAGER ||
      !manager.isActive
    ) {
      throw BusinessErrors.invalidReference(
        'managerId',
        "The selected manager isn't an active manager in your organization.",
      );
    }
  }
}
