import { HttpStatus, Injectable } from '@nestjs/common';
import { formatMoney } from '@fieldops/shared/money';

import { writeAudit } from '../audit/audit.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppException } from '../common/errors/app-exception.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import {
  calendarDate,
  dateOnly,
  startOfDay,
  toAmount,
} from '../common/money.js';
import { orgScope, type OrgScope } from '../common/tenancy/scope.js';
import type { CollectionFigures } from '@fieldops/types';

import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Order, Prisma } from '../generated/prisma/client.js';
import { AccessService } from '../access/access.service.js';
import {
  OrderDetailDto,
  orderDetailInclude,
  OrderSummaryDto,
  orderSummaryInclude,
  paymentInclude,
  PaymentRecordDto,
  ShopAccountDto,
  type CreateOrderDto,
  type ListOrdersQueryDto,
} from './dto/order.dto.js';
import { collectable, createOrder, lockOrder, pendingTotal } from './ledger.js';
import { ShopsService } from './shops.service.js';

const DEFAULT_LIMIT = 50;
const ACCOUNT_ORDERS = 50;
const ACCOUNT_PAYMENTS = 20;

/** Open operations that refer to an order and would be orphaned by its cancellation. */
const OPEN_JOB_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'SUBMITTED',
] as const;

export interface OrganizationMoney {
  readonly currency: string;
  readonly timeZone: string;
}

/**
 * Orders and shop accounts (what a shop owes). Staff create orders for shops they reach;
 * balances are always derived from orders and verified payments (ledger.ts), never set.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopsService,
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateOrderDto,
  ): Promise<OrderDetailDto> {
    const scope = orgScope(user);
    const shop = await this.shops.usable(scope, dto.shopId, 'shopId');
    const settings = await this.money(scope.organizationId);
    const productIds = dto.items.map(item => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw BusinessErrors.invalid(
        'items',
        'A product is listed twice; combine the quantities.',
      );
    }
    const products = await this.catalog.activeProductsById(
      scope.organizationId,
      productIds,
      'items',
    );
    const orderDate =
      dto.orderDate ?? calendarDate(new Date(), settings.timeZone);
    if (dto.dueDate < orderDate) {
      throw BusinessErrors.invalid(
        'dueDate',
        "The due date can't be before the order date.",
      );
    }

    const order = await this.prisma.$transaction(async tx => {
      const created = await createOrder(tx, {
        organizationId: scope.organizationId,
        shopId: shop.id,
        createdById: scope.userId,
        items: dto.items.map(item => ({
          product: products.get(item.productId)!,
          quantity: item.quantity,
        })),
        orderDate: dateOnly(orderDate),
        dueDate: dateOnly(dto.dueDate),
        notes: dto.notes ?? null,
        sourceJobId: null,
      });
      await writeAudit(tx, {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: 'order.created',
        entityType: 'order',
        entityId: created.id,
        summary: `Order ${created.orderNumber} for ${shop.name}: ${formatMoney(
          toAmount(created.totalAmount),
          settings.currency,
        )}`,
        data: { shopId: shop.id, total: toAmount(created.totalAmount) },
      });
      return created;
    });
    return this.detail(order.id, settings.timeZone);
  }

  async list(
    user: AuthenticatedUser,
    query: ListOrdersQueryDto,
  ): Promise<OrderSummaryDto[]> {
    const scope = orgScope(user);
    if (query.shopId !== undefined) {
      await this.shops.reachable(scope, query.shopId);
    }
    const shopIds =
      query.shopId === undefined
        ? await this.access.shopFilter(scope)
        : [query.shopId];
    const settings = await this.money(scope.organizationId);
    const where: Prisma.OrderWhereInput = {
      organizationId: scope.organizationId,
      ...(shopIds !== undefined && { shopId: { in: shopIds } }),
      ...(query.filter === 'OPEN' && {
        status: { in: ['OPEN', 'PARTIALLY_DELIVERED'] },
      }),
      ...(query.filter === 'UNPAID' && {
        status: { not: 'CANCELLED' },
        paidAmount: { lt: this.prisma.order.fields.totalAmount },
      }),
    };
    const rows = await this.prisma.order.findMany({
      where,
      include: orderSummaryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? DEFAULT_LIMIT,
    });
    return this.summaries(rows, settings.timeZone);
  }

  async get(user: AuthenticatedUser, id: string): Promise<OrderDetailDto> {
    const scope = orgScope(user);
    const order = await this.loadReachable(scope, id);
    const settings = await this.money(scope.organizationId);
    return this.detail(order.id, settings.timeZone);
  }

  /**
   * Cancels an order nobody has acted on: nothing paid or waiting for verification, nothing
   * delivered, and no open operation refers to it. Anything else must be resolved first, so
   * money and deliveries are never orphaned.
   */
  async cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<OrderDetailDto> {
    const scope = orgScope(user);
    const order = await this.loadReachable(scope, id);
    const settings = await this.money(scope.organizationId);
    if (order.status === 'CANCELLED') {
      return this.detail(id, settings.timeZone);
    }
    await this.prisma.$transaction(async tx => {
      const locked = await lockOrder(tx, id);
      // One after another: a transaction's connection runs one query at a time.
      const pending = await pendingTotal(tx, id);
      const delivered = await tx.orderItem.count({
        where: { orderId: id, deliveredQuantity: { gt: 0 } },
      });
      const openJobs = await tx.job.count({
        where: { orderId: id, status: { in: [...OPEN_JOB_STATUSES] } },
      });
      if (locked.paidAmount > 0n || pending > 0n) {
        throw notCancellable('Payments have been recorded against this order.');
      }
      if (delivered > 0) {
        throw notCancellable('Part of this order has been delivered.');
      }
      if (openJobs > 0) {
        throw notCancellable(
          'Operations are open for this order. Cancel them first.',
        );
      }
      await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      await writeAudit(tx, {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: 'order.cancelled',
        entityType: 'order',
        entityId: id,
        summary: `Order ${locked.orderNumber} cancelled`,
        data: { reason },
      });
    });
    return this.detail(id, settings.timeZone);
  }

  /** GET /shops/:id/account: the shop's balance, orders and recent payments. */
  async account(
    user: AuthenticatedUser,
    shopId: string,
  ): Promise<ShopAccountDto> {
    const scope = orgScope(user);
    await this.shops.reachable(scope, shopId);
    const settings = await this.money(scope.organizationId);
    const today = calendarDate(new Date(), settings.timeZone);
    const live = {
      organizationId: scope.organizationId,
      shopId,
      status: { not: 'CANCELLED' },
    } as const satisfies Prisma.OrderWhereInput;

    const [totals, overdueRows, pending, orders, payments] = await Promise.all([
      this.prisma.order.aggregate({
        where: live,
        _sum: { totalAmount: true, paidAmount: true },
      }),
      this.prisma.order.findMany({
        where: {
          ...live,
          dueDate: { lt: dateOnly(today) },
          paidAmount: { lt: this.prisma.order.fields.totalAmount },
        },
        select: { totalAmount: true, paidAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          organizationId: scope.organizationId,
          status: 'PENDING_VERIFICATION',
          order: { shopId },
        },
        _sum: { amount: true },
      }),
      this.prisma.order.findMany({
        where: { organizationId: scope.organizationId, shopId },
        include: orderSummaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACCOUNT_ORDERS,
      }),
      this.prisma.payment.findMany({
        where: { organizationId: scope.organizationId, order: { shopId } },
        include: paymentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACCOUNT_PAYMENTS,
      }),
    ]);
    const ordered = totals._sum.totalAmount ?? 0n;
    const paid = totals._sum.paidAmount ?? 0n;
    const overdue = overdueRows.reduce(
      (sum, row) => sum + row.totalAmount - row.paidAmount,
      0n,
    );
    return Object.assign(new ShopAccountDto(), {
      shopId,
      currency: settings.currency,
      totalOrdered: toAmount(ordered),
      totalPaid: toAmount(paid),
      outstanding: toAmount(ordered - paid),
      overdue: toAmount(overdue),
      pendingVerification: toAmount(pending._sum.amount ?? 0n),
      orders: await this.summaries(orders, settings.timeZone),
      recentPayments: payments.map(row => PaymentRecordDto.from(row)),
    });
  }

  /**
   * An order an operation may be created for: of the caller's organization, of `shopId`, not
   * cancelled. A mismatch is an INVALID_REFERENCE of `field`.
   */
  async orderForOperation(
    scope: OrgScope,
    orderId: string,
    shopId: string,
    field: string,
  ): Promise<Order & { items: Prisma.OrderItemGetPayload<object>[] }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId: scope.organizationId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (order === null || order.shopId !== shopId) {
      throw BusinessErrors.invalidReference(
        field,
        "The order doesn't exist or belongs to another shop.",
      );
    }
    if (order.status === 'CANCELLED') {
      throw BusinessErrors.invalidReference(
        field,
        'The order has been cancelled.',
      );
    }
    return order;
  }

  /**
   * What a new collection may still ask for on the order: the collectable balance minus the
   * amounts already assigned to other open collections, so two workers are never sent to
   * collect the same money.
   */
  async unassignedBalance(orderId: string): Promise<bigint> {
    return this.prisma.$transaction(async tx => {
      const order = await lockOrder(tx, orderId);
      const remaining = collectable(order, await pendingTotal(tx, orderId));
      const { _sum } = await tx.job.aggregate({
        where: {
          orderId,
          type: 'PAYMENT_COLLECTION',
          status: {
            in: [
              'PENDING',
              'ASSIGNED',
              'ACCEPTED',
              'EN_ROUTE',
              'ARRIVED',
              'IN_PROGRESS',
            ],
          },
        },
        _sum: { expectedAmount: true },
      });
      const left = remaining - (_sum.expectedAmount ?? 0n);
      return left > 0n ? left : 0n;
    });
  }

  /**
   * The dashboard's money figures for the shops in scope (`undefined`: every shop), from
   * orders and payments only. Every "outstanding" is sum(total) - sum(paid) over live
   * orders, which equals the sum of each order's balance because paid never exceeds total.
   */
  async collectionFigures(
    organizationId: string,
    shopIds: readonly string[] | undefined,
    now: Date,
  ): Promise<CollectionFigures> {
    const settings = await this.money(organizationId);
    const todayText = calendarDate(now, settings.timeZone);
    const today = dateOnly(todayText);
    const shops = shopIds === undefined ? {} : { shopId: { in: [...shopIds] } };
    const live = {
      organizationId,
      ...shops,
      status: { not: 'CANCELLED' },
    } as const satisfies Prisma.OrderWhereInput;
    const balance = (where: Prisma.OrderWhereInput) =>
      this.prisma.order
        .aggregate({ where, _sum: { totalAmount: true, paidAmount: true } })
        .then(({ _sum }) => (_sum.totalAmount ?? 0n) - (_sum.paidAmount ?? 0n));
    const paymentShops =
      shopIds === undefined ? {} : { order: { shopId: { in: [...shopIds] } } };
    const [outstanding, dueToday, overdue, collected, pending] =
      await Promise.all([
        balance(live),
        balance({ ...live, dueDate: today }),
        balance({ ...live, dueDate: { lt: today } }),
        this.prisma.payment.aggregate({
          where: {
            organizationId,
            ...paymentShops,
            status: 'VERIFIED',
            verifiedAt: { gte: startOfDay(todayText, settings.timeZone) },
          },
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            organizationId,
            ...paymentShops,
            status: 'PENDING_VERIFICATION',
          },
          _sum: { amount: true },
        }),
      ]);
    return {
      currency: settings.currency,
      outstanding: toAmount(outstanding),
      dueToday: toAmount(dueToday),
      overdue: toAmount(overdue),
      collectedToday: toAmount(collected._sum.amount ?? 0n),
      pendingVerification: toAmount(pending._sum.amount ?? 0n),
    };
  }

  /** The organization's currency and time zone. */
  async money(organizationId: string): Promise<OrganizationMoney> {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { currency: true, timeZone: true },
    });
  }

  private async loadReachable(scope: OrgScope, id: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId: scope.organizationId },
    });
    if (order === null) {
      throw BusinessErrors.notFound('Order');
    }
    try {
      await this.shops.reachable(scope, order.shopId);
    } catch {
      throw BusinessErrors.notFound('Order');
    }
    return order;
  }

  private async detail(id: string, timeZone: string): Promise<OrderDetailDto> {
    const row = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: orderDetailInclude,
    });
    return OrderDetailDto.detail(row, calendarDate(new Date(), timeZone));
  }

  private async summaries(
    rows: Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>[],
    timeZone: string,
  ): Promise<OrderSummaryDto[]> {
    const today = calendarDate(new Date(), timeZone);
    const pending =
      rows.length === 0
        ? []
        : await this.prisma.payment.groupBy({
            by: ['orderId'],
            where: {
              orderId: { in: rows.map(row => row.id) },
              status: 'PENDING_VERIFICATION',
            },
            _sum: { amount: true },
          });
    const pendingByOrder = new Map(
      pending.map(row => [row.orderId, row._sum.amount ?? 0n]),
    );
    return rows.map(row =>
      OrderSummaryDto.from(row, pendingByOrder.get(row.id) ?? 0n, today),
    );
  }
}

function notCancellable(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.ORDER_NOT_CANCELLABLE,
    `This order can't be cancelled: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
  );
}
