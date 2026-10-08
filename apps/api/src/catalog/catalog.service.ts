import { Injectable } from '@nestjs/common';

import { changesOf, writeAudit } from '../audit/audit.js';
import { CacheKeys, CacheTtl } from '../cache/cache-keys.js';
import { CacheService } from '../cache/cache.service.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { orgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Product } from '../generated/prisma/client.js';
import {
  ProductDto,
  type CreateProductDto,
  type ListProductsQueryDto,
  type UpdateProductDto,
} from './dto/product.dto.js';

const DEFAULT_LIMIT = 200;
/** The most products listed at once (ListProductsQueryDto's maximum limit). */
const ACTIVE_CATALOG_LIMIT = 500;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/**
 * Owns the `products` table: each organization's catalog. Every member can read it (workers
 * need it to take orders); ORGANIZATION_ADMINs manage it. A product of another organization
 * is never found, so it can never end up on an order or an operation.
 *
 * The ACTIVE catalog is cached (every worker downloads it with their working set, and it
 * changes rarely); create and update invalidate it after they commit. Order lines and
 * operations still validate products against PostgreSQL (activeProductsById), so a price is
 * never taken from the cache.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<ProductDto[]> {
    const scope = orgScope(user);
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (query.status !== 'ALL') {
      // Same order and filter as the cached list, which holds up to the maximum limit.
      return (await this.activeProducts(scope.organizationId)).slice(0, limit);
    }
    const rows = await this.prisma.product.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(row => ProductDto.from(row));
  }

  /** The organization's active products (the worker's offline catalog). */
  async activeProducts(organizationId: string): Promise<ProductDto[]> {
    return this.cache.getOrLoad(
      CacheKeys.activeCatalog(organizationId),
      CacheTtl.activeCatalog,
      async () => {
        const rows = await this.prisma.product.findMany({
          where: { organizationId, status: 'ACTIVE' },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: ACTIVE_CATALOG_LIMIT,
        });
        return rows.map(row => ProductDto.from(row));
      },
    );
  }

  async get(user: AuthenticatedUser, id: string): Promise<ProductDto> {
    return ProductDto.from(await this.load(orgScope(user).organizationId, id));
  }

  async create(
    admin: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductDto> {
    const scope = orgScope(admin);
    try {
      const row = await this.prisma.$transaction(async tx => {
        const created = await tx.product.create({
          data: {
            organizationId: scope.organizationId,
            name: dto.name,
            sku: dto.sku.toUpperCase(),
            category: dto.category ?? null,
            unitPrice: BigInt(dto.unitPrice),
          },
        });
        await writeAudit(tx, {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: 'product.created',
          entityType: 'product',
          entityId: created.id,
          summary: `Product ${created.name} (${created.sku}) created`,
          data: { unitPrice: dto.unitPrice },
        });
        return created;
      });
      await this.cache.invalidate(
        CacheKeys.activeCatalog(scope.organizationId),
      );
      return ProductDto.from(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw BusinessErrors.alreadyExists(
          'sku',
          'A product with this SKU already exists.',
        );
      }
      throw error;
    }
  }

  async update(
    admin: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductDto> {
    const scope = orgScope(admin);
    const current = await this.load(scope.organizationId, id);
    const row = await this.prisma.$transaction(async tx => {
      const updated = await tx.product.update({
        where: { id: current.id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...(dto.unitPrice !== undefined && {
            unitPrice: BigInt(dto.unitPrice),
          }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });
      await writeAudit(tx, {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: 'product.updated',
        entityType: 'product',
        entityId: id,
        summary:
          dto.unitPrice !== undefined &&
          BigInt(dto.unitPrice) !== current.unitPrice
            ? `Product ${updated.name}: price changed`
            : `Product ${updated.name} updated`,
        data: {
          changes: changesOf(dto),
          previousUnitPrice: Number(current.unitPrice),
        },
      });
      return updated;
    });
    await this.cache.invalidate(CacheKeys.activeCatalog(scope.organizationId));
    return ProductDto.from(row);
  }

  /**
   * The organization's ACTIVE products with these IDs, or an INVALID_REFERENCE naming the
   * field. Another organization's product is simply not among them.
   */
  async activeProductsById(
    organizationId: string,
    ids: readonly string[],
    field: string,
  ): Promise<Map<string, Product>> {
    const rows = await this.prisma.product.findMany({
      where: { organizationId, id: { in: [...ids] }, status: 'ACTIVE' },
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    if (ids.some(id => !byId.has(id))) {
      throw BusinessErrors.invalidReference(
        field,
        'A product is not in your catalog or is no longer sold.',
      );
    }
    return byId;
  }

  private async load(organizationId: string, id: string): Promise<Product> {
    const row = await this.prisma.product.findFirst({
      where: { id, organizationId },
    });
    if (row === null) {
      throw BusinessErrors.notFound('Product');
    }
    return row;
  }
}
