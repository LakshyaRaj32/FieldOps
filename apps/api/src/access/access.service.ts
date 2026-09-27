import { Injectable } from '@nestjs/common';

import type { OrgScope } from '../common/tenancy/scope.js';
import { PrismaService } from '../database/prisma.service.js';
import { Role } from '../users/role.js';

/**
 * Who can reach what inside an organization: the read side of teams (team_memberships,
 * written by the users module) and shop assignments (shop_assignments, written by the shops
 * module). Every scoped-manager check in the API asks these questions, so they are answered
 * in one place (docs/business-domain.md, "Roles and scopes").
 *
 * A filter of `undefined` means "the whole organization" (organization-wide callers). The
 * organization itself is always filtered separately, by the caller of these methods.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Workers currently in the manager's team. */
  async teamWorkerIds(managerId: string): Promise<string[]> {
    const rows = await this.prisma.teamMembership.findMany({
      where: { managerId, endedAt: null },
      select: { workerId: true },
    });
    return rows.map(row => row.workerId);
  }

  async isInTeam(managerId: string, workerId: string): Promise<boolean> {
    return (
      (await this.prisma.teamMembership.count({
        where: { managerId, workerId, endedAt: null },
      })) > 0
    );
  }

  /** Shops the user is currently assigned to. */
  async assignedShopIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.shopAssignment.findMany({
      where: { userId, endedAt: null },
      select: { shopId: true },
    });
    return rows.map(row => row.shopId);
  }

  async isAssignedToShop(userId: string, shopId: string): Promise<boolean> {
    return (
      (await this.prisma.shopAssignment.count({
        where: { userId, shopId, endedAt: null },
      })) > 0
    );
  }

  /** The shops a staff member reaches: every shop, or the ones they cover. */
  shopFilter(scope: OrgScope): Promise<string[] | undefined> {
    return scope.organizationWide
      ? Promise.resolve(undefined)
      : this.assignedShopIds(scope.userId);
  }

  /** The workers a staff member may see and assign: everyone, or their team. */
  workerFilter(scope: OrgScope): Promise<string[] | undefined> {
    return scope.organizationWide
      ? Promise.resolve(undefined)
      : this.teamWorkerIds(scope.userId);
  }

  /** Whether a staff member reaches the shop (the shop is known to be in their organization). */
  async canReachShop(scope: OrgScope, shopId: string): Promise<boolean> {
    return (
      scope.organizationWide ||
      (scope.role === Role.MANAGER &&
        (await this.isAssignedToShop(scope.userId, shopId)))
    );
  }

  /**
   * Who is told about a shop's business events that concern no single operation (an overdue
   * payment): the managers covering it, the organization's admins and its managers with
   * organization-wide access. Active people only.
   */
  async shopStakeholders(
    organizationId: string,
    shopId: string,
  ): Promise<string[]> {
    const [covering, organizationWide] = await Promise.all([
      this.prisma.shopAssignment.findMany({
        where: {
          shopId,
          organizationId,
          endedAt: null,
          user: { role: Role.MANAGER, isActive: true },
        },
        select: { userId: true },
      }),
      this.prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { role: Role.ORGANIZATION_ADMIN },
            { role: Role.MANAGER, organizationWideAccess: true },
          ],
        },
        select: { id: true },
      }),
    ]);
    return [
      ...new Set([
        ...covering.map(row => row.userId),
        ...organizationWide.map(row => row.id),
      ]),
    ];
  }
}
