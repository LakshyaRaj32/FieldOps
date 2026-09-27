import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { IdParamDto } from '../common/dto/id-param.dto.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { Role } from '../users/role.js';
import {
  CancelOrderDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderDetailDto,
  OrderSummaryDto,
} from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

const DENIED = [
  { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
  {
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN; NOT_IN_ORGANIZATION',
  },
] as const;

/** Orders under /api/v1/orders. Staff, for the shops in their scope. */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.MANAGER, Role.ORGANIZATION_ADMIN)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Orders in my scope, newest first' })
  @ApiEnvelopeResponse(OrderSummaryDto, {
    description: 'Orders.',
    isArray: true,
  })
  @ApiErrorResponses(...DENIED)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderSummaryDto[]> {
    return this.orders.list(user, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an order for a shop',
    description:
      'Prices come from the catalog now; the total is computed by the server. Items never ' +
      'change afterwards (cancel and order again).',
  })
  @ApiEnvelopeResponse(OrderDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The order.',
  })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'INVALID_REFERENCE: the shop or a product cannot be used.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderDetailDto> {
    return this.orders.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'An order with its items and payments' })
  @ApiEnvelopeResponse(OrderDetailDto, { description: 'The order.' })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<OrderDetailDto> {
    return this.orders.get(user, params.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order nothing has happened to yet',
  })
  @ApiEnvelopeResponse(OrderDetailDto, { description: 'The order.' })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.CONFLICT,
    description:
      'ORDER_NOT_CANCELLABLE: payments, deliveries or open operations exist.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDetailDto> {
    return this.orders.cancel(user, params.id, dto.reason);
  }
}
