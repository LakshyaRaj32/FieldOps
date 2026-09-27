import {
  OrderStatus,
  PaymentState,
  Role,
  ShopStatus,
  type OrderDetail,
  type OrderSummary,
  type Shop,
  type ShopAccount,
  type ShopDetail,
} from '@fieldops/types';

import {
  isArrayOf,
  isNullableGeoPoint,
  isNullableString,
  isNumber,
  isRecord,
  isString,
  isUserSummary,
  oneOf,
  isBoolean,
} from '../../../services/api/guards';
import { isPaymentRecord } from '../../jobs/api/contracts';

const isShopStatus = oneOf(ShopStatus);
const isOrderStatus = oneOf(OrderStatus);
const isPaymentState = oneOf(PaymentState);
const isRole = oneOf(Role);

export function isShop(value: unknown): value is Shop {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    name,
    ownerName,
    phone,
    email,
    address,
    location,
    status,
    createdAt,
    updatedAt,
  } = value;
  return (
    [id, name, address, createdAt, updatedAt].every(isString) &&
    [ownerName, phone, email].every(isNullableString) &&
    isNullableGeoPoint(location) &&
    isShopStatus(status)
  );
}

export function isShopList(value: unknown): value is Shop[] {
  return isArrayOf(value, isShop);
}

function isAssignee(value: unknown): boolean {
  return (
    isRecord(value) &&
    isUserSummary(value['user']) &&
    isRole(value['role']) &&
    isString(value['startedAt'])
  );
}

export function isShopDetail(value: unknown): value is ShopDetail {
  return (
    isShop(value) &&
    isRecord(value) &&
    isArrayOf(value['managers'], isAssignee) &&
    isArrayOf(value['workers'], isAssignee)
  );
}

export function isOrderSummary(value: unknown): value is OrderSummary {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    orderNumber,
    shop,
    status,
    paymentState,
    orderDate,
    dueDate,
    isOverdue,
    createdAt,
  } = value;
  return (
    [id, orderNumber, orderDate, dueDate, createdAt].every(isString) &&
    isRecord(shop) &&
    isString(shop['id']) &&
    isString(shop['name']) &&
    isOrderStatus(status) &&
    isPaymentState(paymentState) &&
    isBoolean(isOverdue) &&
    ['totalAmount', 'paidAmount', 'outstandingAmount', 'pendingAmount'].every(
      key => isNumber(value[key]),
    )
  );
}

export function isOrderList(value: unknown): value is OrderSummary[] {
  return isArrayOf(value, isOrderSummary);
}

function isOrderItem(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    ['id', 'productId', 'productName', 'sku'].every(key =>
      isString(value[key]),
    ) &&
    ['quantity', 'unitPrice', 'lineTotal', 'deliveredQuantity'].every(key =>
      isNumber(value[key]),
    )
  );
}

export function isOrderDetail(value: unknown): value is OrderDetail {
  if (!isOrderSummary(value) || !isRecord(value)) {
    return false;
  }
  const {
    items,
    payments,
    notes,
    createdBy,
    sourceJobId,
    cancelledAt,
    cancellationReason,
  } = value as Record<string, unknown>;
  return (
    isArrayOf(items, isOrderItem) &&
    isArrayOf(payments, isPaymentRecord) &&
    [notes, sourceJobId, cancelledAt, cancellationReason].every(
      isNullableString,
    ) &&
    isUserSummary(createdBy)
  );
}

export function isShopAccount(value: unknown): value is ShopAccount {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isString(value['shopId']) &&
    isString(value['currency']) &&
    [
      'totalOrdered',
      'totalPaid',
      'outstanding',
      'overdue',
      'pendingVerification',
    ].every(key => isNumber(value[key])) &&
    isArrayOf(value['orders'], isOrderSummary) &&
    isArrayOf(value['recentPayments'], isPaymentRecord)
  );
}
