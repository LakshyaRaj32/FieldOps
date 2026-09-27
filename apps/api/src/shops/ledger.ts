import { HttpStatus } from '@nestjs/common';
import { formatMoney } from '@fieldops/shared/money';

import { AppException } from '../common/errors/app-exception.js';
import { BusinessErrors } from '../common/errors/business-errors.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { toAmount } from '../common/money.js';
import type {
  Order,
  Payment,
  PaymentMethod,
  Prisma,
  Product,
} from '../generated/prisma/client.js';

/**
 * The accounts-receivable ledger: the ONLY code that writes orders' money, payments and
 * delivered quantities. Every function runs inside the caller's transaction (an operation's
 * submission or verification commits together with its payment), and every one that
 * touches an order's balance first locks the order row, so concurrent submissions and
 * verifications for one order are serialized.
 *
 * Money rules (docs/business-domain.md, "Money"):
 * - outstanding = total - verified payments. Nothing else changes a balance.
 * - A worker's payment waits for verification; while it waits it is "pending" and already
 *   reduces what can be collected, so two submissions can never together exceed the
 *   balance. No overpayments (also a CHECK constraint on paid_amount).
 * - A payment reference is used once per organization and method (unless rejected).
 */

type Tx = Prisma.TransactionClient;

export const LedgerErrors = {
  duplicateReference: () =>
    new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.DUPLICATE_PAYMENT_REFERENCE,
      'This payment reference has already been recorded.',
      [
        {
          field: 'payment.reference',
          message: 'This payment reference has already been recorded.',
        },
      ],
    ),
  orderCancelled: (field: string) =>
    BusinessErrors.invalidReference(field, 'The order has been cancelled.'),
} as const;

/** Locks the order row until the transaction ends and returns its current state. */
export async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  await tx.$queryRaw`SELECT 1 FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

/** Sum of the order's payments waiting for verification. */
export async function pendingTotal(tx: Tx, orderId: string): Promise<bigint> {
  const { _sum } = await tx.payment.aggregate({
    where: { orderId, status: 'PENDING_VERIFICATION' },
    _sum: { amount: true },
  });
  return _sum.amount ?? 0n;
}

/**
 * What can still be collected on the order: outstanding minus what workers already
 * reported collecting (pending verification).
 */
export function collectable(order: Order, pending: bigint): bigint {
  if (order.status === 'CANCELLED') {
    return 0n;
  }
  const remaining = order.totalAmount - order.paidAmount - pending;
  return remaining > 0n ? remaining : 0n;
}

export interface PendingPaymentInput {
  readonly id: string;
  readonly organizationId: string;
  readonly orderId: string;
  readonly jobId: string | null;
  readonly amount: bigint;
  readonly method: PaymentMethod;
  /** Already normalized (trimmed, upper-case), or null for cash without one. */
  readonly reference: string | null;
  readonly collectedAt: Date;
  readonly recordedById: string;
  readonly currency: string;
}

/**
 * Records a payment a worker collected, waiting for verification. Refuses an amount above
 * what can still be collected and a reference already on record.
 */
export async function recordPendingPayment(
  tx: Tx,
  input: PendingPaymentInput,
): Promise<Payment> {
  const order = await lockOrder(tx, input.orderId);
  if (order.status === 'CANCELLED') {
    throw LedgerErrors.orderCancelled('payment');
  }
  const remaining = collectable(order, await pendingTotal(tx, order.id));
  if (input.amount > remaining) {
    throw BusinessErrors.amountExceedsBalance(
      'payment.amount',
      remaining === 0n
        ? 'Nothing is left to collect on this order.'
        : `Amount exceeds the remaining balance of ${formatMoney(toAmount(remaining), input.currency)}.`,
    );
  }
  if (input.reference !== null) {
    const used = await tx.payment.count({
      where: {
        organizationId: input.organizationId,
        method: input.method,
        reference: input.reference,
        status: { not: 'REJECTED' },
      },
    });
    if (used > 0) {
      throw LedgerErrors.duplicateReference();
    }
  }
  return tx.payment.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      orderId: order.id,
      jobId: input.jobId,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      collectedAt: input.collectedAt,
      recordedById: input.recordedById,
    },
  });
}

/**
 * A manager verifies a pending payment: it now counts, and the order's paid amount grows by
 * it (never beyond the total: checked here and by the database).
 */
export async function verifyPayment(
  tx: Tx,
  paymentId: string,
  verifierId: string,
  now: Date,
): Promise<Payment> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
  });
  if (payment.status !== 'PENDING_VERIFICATION') {
    return payment;
  }
  const order = await lockOrder(tx, payment.orderId);
  if (order.paidAmount + payment.amount > order.totalAmount) {
    throw BusinessErrors.amountExceedsBalance(
      'payment.amount',
      'Verifying this payment would pay more than the order total.',
    );
  }
  const verified = await tx.payment.update({
    where: { id: paymentId },
    data: { status: 'VERIFIED', verifiedById: verifierId, verifiedAt: now },
  });
  await tx.order.update({
    where: { id: order.id },
    data: { paidAmount: { increment: payment.amount } },
  });
  return verified;
}

/** A manager rejects a pending payment: it never counts, and its reference is free again. */
export async function rejectPayment(
  tx: Tx,
  paymentId: string,
  verifierId: string,
  reason: string,
  now: Date,
): Promise<Payment> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
  });
  if (payment.status !== 'PENDING_VERIFICATION') {
    return payment;
  }
  // Lock the order too: the pending amount (and so the collectable balance) changes.
  await lockOrder(tx, payment.orderId);
  return tx.payment.update({
    where: { id: paymentId },
    data: {
      status: 'REJECTED',
      verifiedById: verifierId,
      verifiedAt: now,
      rejectionReason: reason,
    },
  });
}

export interface DeliveredLine {
  readonly orderItemId: string;
  readonly quantity: number;
}

/**
 * A verified delivery raises the order items' delivered quantities (never beyond what was
 * ordered) and moves the order to PARTIALLY_DELIVERED or DELIVERED.
 */
export async function recordDelivery(
  tx: Tx,
  orderId: string,
  lines: readonly DeliveredLine[],
): Promise<Order> {
  const order = await lockOrder(tx, orderId);
  if (order.status === 'CANCELLED') {
    throw LedgerErrors.orderCancelled('lineCounts');
  }
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const byId = new Map(items.map(item => [item.id, item]));
  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (item === undefined) {
      throw BusinessErrors.invalidReference(
        'lineCounts',
        'A delivered line is not part of the order.',
      );
    }
    if (item.deliveredQuantity + line.quantity > item.quantity) {
      throw BusinessErrors.invalidReference(
        'lineCounts',
        `More ${item.productName} would be delivered than was ordered.`,
      );
    }
    if (line.quantity > 0) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { deliveredQuantity: { increment: line.quantity } },
      });
    }
  }
  const after = await tx.orderItem.findMany({ where: { orderId } });
  const complete = after.every(item => item.deliveredQuantity >= item.quantity);
  const started = after.some(item => item.deliveredQuantity > 0);
  return tx.order.update({
    where: { id: orderId },
    data: {
      status: complete ? 'DELIVERED' : started ? 'PARTIALLY_DELIVERED' : 'OPEN',
    },
  });
}

export interface NewOrderInput {
  readonly organizationId: string;
  readonly shopId: string;
  readonly createdById: string;
  readonly items: readonly {
    readonly product: Product;
    readonly quantity: number;
  }[];
  /** DATE values (midnight UTC). */
  readonly orderDate: Date;
  readonly dueDate: Date;
  readonly notes: string | null;
  readonly sourceJobId: string | null;
}

/**
 * Creates an order with the next number of its organization. Prices are copied from the
 * products now; the total is computed here, never taken from a client.
 */
export async function createOrder(
  tx: Tx,
  input: NewOrderInput,
): Promise<Order> {
  // The UPDATE locks the organization row, so numbers are unique and gap-free per tenant.
  const { nextOrderNumber } = await tx.organization.update({
    where: { id: input.organizationId },
    data: { nextOrderNumber: { increment: 1 } },
    select: { nextOrderNumber: true },
  });
  const items = input.items.map((item, position) => ({
    position,
    productId: item.product.id,
    productName: item.product.name,
    sku: item.product.sku,
    quantity: item.quantity,
    unitPrice: item.product.unitPrice,
    lineTotal: item.product.unitPrice * BigInt(item.quantity),
  }));
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0n);
  return tx.order.create({
    data: {
      organizationId: input.organizationId,
      shopId: input.shopId,
      orderNumber: `ORD-${nextOrderNumber - 1}`,
      totalAmount: total,
      orderDate: input.orderDate,
      dueDate: input.dueDate,
      notes: input.notes,
      createdById: input.createdById,
      sourceJobId: input.sourceJobId,
      items: { create: items },
    },
  });
}

/** Normalizes a payment reference (the uniqueness check ignores case and spaces). */
export function normalizeReference(
  reference: string | undefined,
): string | null {
  if (reference === undefined) {
    return null;
  }
  const normalized = reference.trim().replace(/\s+/g, '').toUpperCase();
  return normalized === '' ? null : normalized;
}
