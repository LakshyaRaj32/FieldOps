import { Injectable } from '@nestjs/common';

import { AccessService } from '../access/access.service.js';
import { changesOf, writeAudit } from '../audit/audit.js';
import { AuthErrors } from '../common/errors/app-exception.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { orgScope, type OrgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Shop } from '../generated/prisma/client.js';
import { Role } from '../users/role.js';
import {
  ShopDetailDto,
  ShopDto,
  type CreateShopDto,
  type ListShopsQueryDto,
  type UpdateShopDto,
} from './dto/shop.dto.js';

export type ShopRecord = Shop;

const detailInclude = {
  assignments: {
    where: { endedAt: null },
    orderBy: { startedAt: 'asc' },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, role: true },
      },
    },
  },
} as const satisfies Prisma.ShopInclude;

export type ShopDetailRecord = Prisma.ShopGetPayload<{
  include: typeof detailInclude;
}>;

const DEFAULT_LIMIT = 200;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/**
 * Owns the `shops` and `shop_assignments` tables. A shop belongs to its organization; who
 * covers or serves it is a separate, dated assignment (many managers and workers per shop,
 * many shops per person).
 *
 * - ORGANIZATION_ADMINs create and edit shops and assign anyone of the organization.
 * - MANAGERs see the shops they cover (all of them with organization-wide access) and
 *   assign the workers of their team to those shops.
 * - A shop outside the caller's organization or scope is "not found".
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListShopsQueryDto,
  ): Promise<ShopDto[]> {
    const scope = orgScope(user);
    const ids = await this.access.shopFilter(scope);
    const rows = await this.prisma.shop.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(ids !== undefined && { id: { in: ids } }),
        ...(query.status !== 'ALL' && { status: 'ACTIVE' }),
        ...(query.search !== undefined &&
          query.search !== '' && {
            name: { contains: query.search, mode: 'insensitive' },
          }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit ?? DEFAULT_LIMIT,
    });
    return rows.map(row => ShopDto.from(row));
  }

  async get(user: AuthenticatedUser, id: string): Promise<ShopDetailDto> {
    const scope = orgScope(user);
    await this.reachable(scope, id);
    return ShopDetailDto.from(await this.loadDetail(id));
  }

  async create(
    admin: AuthenticatedUser,
    dto: CreateShopDto,
  ): Promise<ShopDetailDto> {
    const scope = orgScope(admin);
    try {
      const shop = await this.prisma.$transaction(async tx => {
        const created = await tx.shop.create({
          data: {
            organizationId: scope.organizationId,
            name: dto.name,
            ownerName: dto.ownerName ?? null,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            address: dto.address,
            latitude: dto.location?.latitude ?? null,
            longitude: dto.location?.longitude ?? null,
          },
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: 'shop.created',
          entityType: 'shop',
          entityId: created.id,
          summary: `Shop ${created.name} created`,
        });
        return created;
      });
      return ShopDetailDto.from(await this.loadDetail(shop.id));
    } catch (error) {
      throw this.nameTaken(error);
    }
  }

  async update(
    admin: AuthenticatedUser,
    id: string,
    dto: UpdateShopDto,
  ): Promise<ShopDetailDto> {
    const scope = orgScope(admin);
    const shop = await this.load(scope, id);
    try {
      await this.prisma.$transaction(async tx => {
        await tx.shop.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.ownerName !== undefined && { ownerName: dto.ownerName }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.email !== undefined && { email: dto.email }),
            ...(dto.address !== undefined && { address: dto.address }),
            ...(dto.location !== undefined && {
              latitude: dto.location?.latitude ?? null,
              longitude: dto.location?.longitude ?? null,
            }),
            ...(dto.status !== undefined && { status: dto.status }),
          },
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: 'shop.updated',
          entityType: 'shop',
          entityId: id,
          summary: `Shop ${dto.name ?? shop.name} updated`,
          data: { changes: changesOf(dto) },
        });
      });
    } catch (error) {
      throw this.nameTaken(error);
    }
    return ShopDetailDto.from(await this.loadDetail(id));
  }

  /**
   * Assigns a manager or worker of the organization to the shop. Admins may assign anyone;
   * a manager may assign workers of their own team to a shop they cover. Repeating an
   * existing assignment changes nothing.
   */
  async assign(
    user: AuthenticatedUser,
    shopId: string,
    userId: string,
  ): Promise<ShopDetailDto> {
    const scope = orgScope(user);
    const shop = await this.reachable(scope, shopId);
    const person = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: scope.organizationId },
    });
    if (
      person === null ||
      !person.isActive ||
      (person.role !== Role.WORKER && person.role !== Role.MANAGER)
    ) {
      throw BusinessErrors.invalidReference(
        'userId',
        "The selected person isn't an active manager or worker in your organization.",
      );
    }
    if (scope.role === Role.MANAGER && !scope.organizationWide) {
      if (
        person.role !== Role.WORKER ||
        !(await this.access.isInTeam(scope.userId, person.id))
      ) {
        throw BusinessErrors.invalidReference(
          'userId',
          'You can assign only workers of your own team.',
        );
      }
    }
    try {
      await this.prisma.$transaction(async tx => {
        const existing = await tx.shopAssignment.count({
          where: { shopId, userId, endedAt: null },
        });
        if (existing > 0) {
          return;
        }
        await tx.shopAssignment.create({
          data: { organizationId: scope.organizationId, shopId, userId },
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: 'shop.assignment_added',
          entityType: 'shop',
          entityId: shopId,
          summary: `${person.firstName} ${person.lastName} assigned to ${shop.name}`,
          data: { userId, role: person.role },
        });
      });
    } catch (error) {
      // Two identical requests at once: the partial unique index kept one.
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return ShopDetailDto.from(await this.loadDetail(shopId));
  }

  /** Ends a current assignment (the row stays as history). Idempotent. */
  async unassign(
    user: AuthenticatedUser,
    shopId: string,
    userId: string,
  ): Promise<ShopDetailDto> {
    const scope = orgScope(user);
    const shop = await this.reachable(scope, shopId);
    if (
      scope.role === Role.MANAGER &&
      !scope.organizationWide &&
      !(await this.access.isInTeam(scope.userId, userId))
    ) {
      throw AuthErrors.forbidden();
    }
    await this.prisma.$transaction(async tx => {
      const { count } = await tx.shopAssignment.updateMany({
        where: { shopId, userId, endedAt: null },
        data: { endedAt: new Date() },
      });
      if (count > 0) {
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: 'shop.assignment_ended',
          entityType: 'shop',
          entityId: shopId,
          summary: `Assignment to ${shop.name} ended`,
          data: { userId },
        });
      }
    });
    return ShopDetailDto.from(await this.loadDetail(shopId));
  }

  /** Active shops of the organization (optionally only `shopIds`), for the dashboard. */
  countActive(
    organizationId: string,
    shopIds: readonly string[] | undefined,
  ): Promise<number> {
    return this.prisma.shop.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        ...(shopIds !== undefined && { id: { in: [...shopIds] } }),
      },
    });
  }

  /**
   * The shop, if it is in the caller's organization and scope; otherwise NOT_FOUND (its
   * existence is not revealed). For other modules too (orders, operations).
   */
  async reachable(scope: OrgScope, shopId: string): Promise<Shop> {
    const shop = await this.load(scope, shopId);
    if (!(await this.access.canReachShop(scope, shopId))) {
      throw BusinessErrors.notFound('Shop');
    }
    return shop;
  }

  /**
   * A shop to create business on (an order, an operation): reachable and active. A shop
   * that fails either is an INVALID_REFERENCE of `field` (the request is refused, and a
   * shop of another organization looks exactly like a missing one).
   */
  async usable(scope: OrgScope, shopId: string, field: string): Promise<Shop> {
    let shop: Shop;
    try {
      shop = await this.reachable(scope, shopId);
    } catch {
      throw BusinessErrors.invalidReference(
        field,
        "The shop doesn't exist or isn't one of your shops.",
      );
    }
    if (shop.status !== 'ACTIVE') {
      throw BusinessErrors.invalidReference(field, 'The shop is inactive.');
    }
    return shop;
  }

  private async load(scope: OrgScope, id: string): Promise<Shop> {
    const shop = await this.prisma.shop.findFirst({
      where: { id, organizationId: scope.organizationId },
    });
    if (shop === null) {
      throw BusinessErrors.notFound('Shop');
    }
    return shop;
  }

  private loadDetail(id: string): Promise<ShopDetailRecord> {
    return this.prisma.shop.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    });
  }

  private nameTaken(error: unknown): unknown {
    return isUniqueViolation(error)
      ? BusinessErrors.alreadyExists(
          'name',
          'Your organization already has a shop with this name.',
        )
      : error;
  }
}
