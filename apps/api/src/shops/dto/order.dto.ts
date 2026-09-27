import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CancelOrderRequest,
  CreateOrderRequest,
  OrderDetail,
  OrderItem,
  OrderItemInput,
  OrderSummary,
  PaymentRecord,
  PaymentState,
  ShopAccount,
} from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { trimmed } from '../../auth/dto/fields.js';
import {
  UserSummaryDto,
  userSummarySelect,
} from '../../common/dto/user-summary.dto.js';
import { LimitField, OptionalText } from '../../common/dto/fields.js';
import { formatDateOnly, toAmount } from '../../common/money.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  type Prisma,
} from '../../generated/prisma/client.js';

export const paymentInclude = {
  recordedBy: userSummarySelect,
  verifiedBy: userSummarySelect,
} as const satisfies Prisma.PaymentInclude;

export type PaymentRow = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

export class PaymentRecordDto implements PaymentRecord {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ format: 'uuid' }) readonly orderId: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly jobId: string | null;
  @ApiProperty({ description: 'Minor units.' }) readonly amount: number;
  @ApiProperty({ enum: Object.values(PaymentMethod) })
  readonly method: PaymentMethod;
  @ApiProperty({ type: String, nullable: true }) readonly reference:
    string | null;
  @ApiProperty({ enum: Object.values(PaymentStatus) })
  readonly status: PaymentStatus;
  @ApiProperty({ format: 'date-time' }) readonly collectedAt: string;
  @ApiProperty({ type: UserSummaryDto }) readonly recordedBy: UserSummaryDto;
  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly verifiedBy: UserSummaryDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly verifiedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) readonly rejectionReason:
    string | null;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;

  static from(row: PaymentRow): PaymentRecordDto {
    return Object.assign(new PaymentRecordDto(), {
      id: row.id,
      orderId: row.orderId,
      jobId: row.jobId,
      amount: toAmount(row.amount),
      method: row.method,
      reference: row.reference,
      status: row.status,
      collectedAt: row.collectedAt.toISOString(),
      recordedBy: UserSummaryDto.from(row.recordedBy),
      verifiedBy:
        row.verifiedBy === null ? null : UserSummaryDto.from(row.verifiedBy),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt.toISOString(),
    } satisfies PaymentRecord);
  }
}

export const orderSummaryInclude = {
  shop: { select: { id: true, name: true } },
} as const satisfies Prisma.OrderInclude;

export type OrderSummaryRow = Prisma.OrderGetPayload<{
  include: typeof orderSummaryInclude;
}>;

export const orderDetailInclude = {
  ...orderSummaryInclude,
  items: { orderBy: { position: 'asc' } },
  payments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: paymentInclude,
  },
  createdBy: userSummarySelect,
} as const satisfies Prisma.OrderInclude;

export type OrderDetailRow = Prisma.OrderGetPayload<{
  include: typeof orderDetailInclude;
}>;

export function paymentState(total: bigint, paid: bigint): PaymentState {
  if (paid >= total) {
    return 'PAID';
  }
  return paid === 0n ? 'UNPAID' : 'PARTIALLY_PAID';
}

function summaryFields(
  row: OrderSummaryRow,
  pending: bigint,
  today: string,
): OrderSummary {
  const cancelled = row.status === 'CANCELLED';
  const outstanding = cancelled ? 0n : row.totalAmount - row.paidAmount;
  const dueDate = formatDateOnly(row.dueDate);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    shop: row.shop,
    status: row.status,
    paymentState: cancelled
      ? 'UNPAID'
      : paymentState(row.totalAmount, row.paidAmount),
    totalAmount: toAmount(row.totalAmount),
    paidAmount: toAmount(row.paidAmount),
    outstandingAmount: toAmount(outstanding),
    pendingAmount: toAmount(pending),
    orderDate: formatDateOnly(row.orderDate),
    dueDate,
    isOverdue: outstanding > 0n && dueDate < today,
    createdAt: row.createdAt.toISOString(),
  };
}

export class OrderSummaryDto implements OrderSummary {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'ORD-1001' }) readonly orderNumber: string;
  @ApiProperty({
    type: 'object',
    properties: { id: { type: 'string' }, name: { type: 'string' } },
  })
  readonly shop: { readonly id: string; readonly name: string };
  @ApiProperty({ enum: Object.values(OrderStatus) })
  readonly status: OrderStatus;
  @ApiProperty({ enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID'] })
  readonly paymentState: PaymentState;
  @ApiProperty() readonly totalAmount: number;
  @ApiProperty() readonly paidAmount: number;
  @ApiProperty() readonly outstandingAmount: number;
  @ApiProperty() readonly pendingAmount: number;
  @ApiProperty({ example: '2026-09-01' }) readonly orderDate: string;
  @ApiProperty({ example: '2026-09-30' }) readonly dueDate: string;
  @ApiProperty() readonly isOverdue: boolean;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;

  static from(
    row: OrderSummaryRow,
    pending: bigint,
    today: string,
  ): OrderSummaryDto {
    return Object.assign(
      new OrderSummaryDto(),
      summaryFields(row, pending, today),
    );
  }
}

export class OrderItemDto implements OrderItem {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ format: 'uuid' }) readonly productId: string;
  @ApiProperty() readonly productName: string;
  @ApiProperty() readonly sku: string;
  @ApiProperty() readonly quantity: number;
  @ApiProperty() readonly unitPrice: number;
  @ApiProperty() readonly lineTotal: number;
  @ApiProperty() readonly deliveredQuantity: number;
}

export class OrderDetailDto extends OrderSummaryDto implements OrderDetail {
  @ApiProperty({ type: [OrderItemDto] }) readonly items: OrderItemDto[];
  @ApiProperty({ type: [PaymentRecordDto] })
  readonly payments: PaymentRecordDto[];
  @ApiProperty({ type: String, nullable: true }) readonly notes: string | null;
  @ApiProperty({ type: UserSummaryDto }) readonly createdBy: UserSummaryDto;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly sourceJobId: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly cancelledAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  readonly cancellationReason: string | null;

  static detail(row: OrderDetailRow, today: string): OrderDetailDto {
    const pending = row.payments
      .filter(payment => payment.status === 'PENDING_VERIFICATION')
      .reduce((sum, payment) => sum + payment.amount, 0n);
    return Object.assign(new OrderDetailDto(), {
      ...summaryFields(row, pending, today),
      items: row.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: toAmount(item.unitPrice),
        lineTotal: toAmount(item.lineTotal),
        deliveredQuantity: item.deliveredQuantity,
      })),
      payments: row.payments.map(payment => PaymentRecordDto.from(payment)),
      notes: row.notes,
      createdBy: UserSummaryDto.from(row.createdBy),
      sourceJobId: row.sourceJobId,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancellationReason: row.cancellationReason,
    } satisfies OrderDetail);
  }
}

export class ShopAccountDto implements ShopAccount {
  @ApiProperty({ format: 'uuid' }) readonly shopId: string;
  @ApiProperty({ example: 'INR' }) readonly currency: string;
  @ApiProperty() readonly totalOrdered: number;
  @ApiProperty() readonly totalPaid: number;
  @ApiProperty() readonly outstanding: number;
  @ApiProperty() readonly overdue: number;
  @ApiProperty() readonly pendingVerification: number;
  @ApiProperty({ type: [OrderSummaryDto] })
  readonly orders: OrderSummaryDto[];
  @ApiProperty({ type: [PaymentRecordDto] })
  readonly recentPayments: PaymentRecordDto[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class OrderItemInputDto implements OrderItemInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Product must be a valid ID.' })
  readonly productId: string;

  @ApiProperty({ minimum: 1, maximum: 1_000_000 })
  @IsInt({ message: 'Quantity must be a whole number.' })
  @Min(1, { message: 'Quantity must be at least 1.' })
  @Max(1_000_000)
  readonly quantity: number;
}

export class CreateOrderDto implements CreateOrderRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Shop must be a valid ID.' })
  readonly shopId: string;

  @ApiProperty({ type: [OrderItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product.' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  readonly items: OrderItemInputDto[];

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE, { message: 'Order date must be YYYY-MM-DD.' })
  readonly orderDate?: string;

  @ApiProperty({ example: '2026-09-30' })
  @Matches(DATE, { message: 'Due date must be YYYY-MM-DD.' })
  readonly dueDate: string;

  @OptionalText('Notes', 2000)
  readonly notes?: string;
}

export class CancelOrderDto implements CancelOrderRequest {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @trimmed()
  @IsString({ message: 'Give a reason.' })
  @MinLength(1, { message: 'Give a reason.' })
  @MaxLength(500)
  readonly reason: string;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  readonly shopId?: string;

  @ApiPropertyOptional({
    enum: ['OPEN', 'UNPAID', 'ALL'],
    default: 'ALL',
    description:
      'OPEN: not cancelled and not fully delivered; UNPAID: not cancelled, something outstanding.',
  })
  @IsOptional()
  @IsIn(['OPEN', 'UNPAID', 'ALL'])
  readonly filter?: 'OPEN' | 'UNPAID' | 'ALL';

  @LimitField(200, 50)
  readonly limit?: number;
}
