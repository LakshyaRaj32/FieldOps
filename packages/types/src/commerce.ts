/**
 * Shops, products, orders and the shop's account (what it owes). See
 * docs/business-domain.md, "Money".
 *
 * Every amount is an integer in the minor unit of the organization's currency (paise for
 * INR: ₹2,00,000 is 20000000). Balances are computed by the server from orders and verified
 * payments; no client ever sends one.
 */

import type { GeoPoint, PaymentRecord, UserSummary } from './jobs';
import type { Role } from './role';

export const ShopStatus = {
  ACTIVE: 'ACTIVE',
  /** Kept with its history; no new operations or orders. */
  INACTIVE: 'INACTIVE',
} as const;

export type ShopStatus = (typeof ShopStatus)[keyof typeof ShopStatus];

/** A customer location owned by the organization (never by a worker or manager). */
export interface Shop {
  readonly id: string;
  readonly name: string;
  readonly ownerName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string;
  readonly location: GeoPoint | null;
  readonly status: ShopStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Someone currently assigned to a shop (a manager covering it, a worker serving it). */
export interface ShopAssignee {
  readonly user: UserSummary;
  readonly role: Role;
  /** ISO 8601: since when. */
  readonly startedAt: string;
}

export interface ShopDetail extends Shop {
  readonly managers: readonly ShopAssignee[];
  readonly workers: readonly ShopAssignee[];
}

export interface CreateShopRequest {
  readonly name: string;
  readonly ownerName?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly address: string;
  readonly location?: GeoPoint;
}

export interface UpdateShopRequest {
  readonly name?: string;
  readonly ownerName?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly address?: string;
  readonly location?: GeoPoint | null;
  readonly status?: ShopStatus;
}

/** POST /shops/:id/assignments: a manager or worker of the organization. */
export interface AssignShopRequest {
  readonly userId: string;
}

export const ProductStatus = {
  ACTIVE: 'ACTIVE',
  /** Kept for old orders; cannot be ordered, delivered or counted any more. */
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export interface Product {
  readonly id: string;
  readonly name: string;
  /** Unique within the organization; never changes. */
  readonly sku: string;
  readonly category: string | null;
  /** Minor units. New orders copy it; existing orders keep the price they were made with. */
  readonly unitPrice: number;
  readonly status: ProductStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProductRequest {
  readonly name: string;
  readonly sku: string;
  readonly category?: string;
  readonly unitPrice: number;
}

export interface UpdateProductRequest {
  readonly name?: string;
  readonly category?: string | null;
  readonly unitPrice?: number;
  readonly status?: ProductStatus;
}

/** Delivery progress of an order. (How much is paid is a separate, computed question.) */
export const OrderStatus = {
  OPEN: 'OPEN',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Computed from the verified payments; never stored or sent by a client. */
export const PaymentState = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
} as const;

export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState];

export interface OrderItem {
  readonly id: string;
  readonly productId: string;
  /** Copied from the product when the order was made. */
  readonly productName: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly deliveredQuantity: number;
}

export interface OrderSummary {
  readonly id: string;
  readonly orderNumber: string;
  readonly shop: { readonly id: string; readonly name: string };
  readonly status: OrderStatus;
  readonly paymentState: PaymentState;
  readonly totalAmount: number;
  /** Sum of verified payments. */
  readonly paidAmount: number;
  /** totalAmount - paidAmount (0 for a cancelled order). */
  readonly outstandingAmount: number;
  /** Collected by workers, not verified yet. */
  readonly pendingAmount: number;
  /** YYYY-MM-DD (organization calendar). */
  readonly orderDate: string;
  /** YYYY-MM-DD: when payment is due. */
  readonly dueDate: string;
  /** Unpaid and past its due date (organization calendar). */
  readonly isOverdue: boolean;
  readonly createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  readonly items: readonly OrderItem[];
  /** Every payment recorded against the order, oldest first. */
  readonly payments: readonly PaymentRecord[];
  readonly notes: string | null;
  readonly createdBy: UserSummary;
  /** The order-collection operation it was taken in, if any. */
  readonly sourceJobId: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
}

export interface OrderItemInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface CreateOrderRequest {
  readonly shopId: string;
  readonly items: readonly OrderItemInput[];
  /** YYYY-MM-DD; defaults to today (organization calendar). */
  readonly orderDate?: string;
  /** YYYY-MM-DD; not before the order date. */
  readonly dueDate: string;
  readonly notes?: string;
}

export interface CancelOrderRequest {
  readonly reason: string;
}

/**
 * GET /shops/:id/account: what the shop owes, derived from its orders and verified payments.
 */
export interface ShopAccount {
  readonly shopId: string;
  readonly currency: string;
  /** Total of the shop's orders that are not cancelled. */
  readonly totalOrdered: number;
  readonly totalPaid: number;
  readonly outstanding: number;
  /** Outstanding on orders past their due date. */
  readonly overdue: number;
  readonly pendingVerification: number;
  /** Newest first (at most 50). */
  readonly orders: readonly OrderSummary[];
  /** Newest first (at most 20). */
  readonly recentPayments: readonly PaymentRecord[];
}
