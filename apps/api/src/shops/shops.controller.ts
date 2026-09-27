import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { ShopAccountDto } from './dto/order.dto.js';
import {
  AssignShopDto,
  CreateShopDto,
  ListShopsQueryDto,
  ShopAssignmentParamDto,
  ShopDetailDto,
  ShopDto,
  UpdateShopDto,
} from './dto/shop.dto.js';
import { OrdersService } from './orders.service.js';
import { ShopsService } from './shops.service.js';

const DENIED = [
  { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
  {
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN; NOT_IN_ORGANIZATION',
  },
] as const;
const NOT_FOUND = {
  status: HttpStatus.NOT_FOUND,
  description:
    'NOT_FOUND: no such shop, or not one of yours (another organization, or a shop you do not cover).',
};

/**
 * Shops under /api/v1/shops. Staff only: MANAGERs see the shops they cover (every shop with
 * organization-wide access), ORGANIZATION_ADMINs every shop of their organization. Workers
 * get the shop details they need inside their operations.
 */
@ApiTags('shops')
@ApiBearerAuth()
@Controller('shops')
@Roles(Role.MANAGER, Role.ORGANIZATION_ADMIN)
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Shops in my scope, by name' })
  @ApiEnvelopeResponse(ShopDto, { description: 'Shops.', isArray: true })
  @ApiErrorResponses(...DENIED)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListShopsQueryDto,
  ): Promise<ShopDto[]> {
    return this.shops.list(user, query);
  }

  @Post()
  @Roles(Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a shop (ORGANIZATION_ADMIN)' })
  @ApiEnvelopeResponse(ShopDetailDto, {
    status: HttpStatus.CREATED,
    description: 'The shop.',
  })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.CONFLICT,
    description: 'ALREADY_EXISTS: the name is taken in the organization.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShopDto,
  ): Promise<ShopDetailDto> {
    return this.shops.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A shop with its current managers and workers' })
  @ApiEnvelopeResponse(ShopDetailDto, { description: 'The shop.' })
  @ApiErrorResponses(...DENIED, NOT_FOUND)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<ShopDetailDto> {
    return this.shops.get(user, params.id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'Change a shop (ORGANIZATION_ADMIN)' })
  @ApiEnvelopeResponse(ShopDetailDto, { description: 'The shop.' })
  @ApiErrorResponses(...DENIED, NOT_FOUND)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateShopDto,
  ): Promise<ShopDetailDto> {
    return this.shops.update(user, params.id, dto);
  }

  @Get(':id/account')
  @ApiOperation({
    summary:
      "The shop's account: outstanding, overdue, orders, recent payments",
    description:
      'Every figure is computed from orders and verified payments (minor units of the ' +
      "organization's currency).",
  })
  @ApiEnvelopeResponse(ShopAccountDto, { description: 'The account.' })
  @ApiErrorResponses(...DENIED, NOT_FOUND)
  account(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<ShopAccountDto> {
    return this.orders.account(user, params.id);
  }

  @Post(':id/assignments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign a manager or worker to the shop',
    description:
      'Admins assign anyone of the organization; managers assign workers of their team to ' +
      'shops they cover. Repeating an assignment changes nothing.',
  })
  @ApiEnvelopeResponse(ShopDetailDto, { description: 'The shop.' })
  @ApiErrorResponses(...DENIED, NOT_FOUND, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'INVALID_REFERENCE: the person cannot be assigned by you.',
  })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: AssignShopDto,
  ): Promise<ShopDetailDto> {
    return this.shops.assign(user, params.id, dto.userId);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End an assignment (kept as history)',
  })
  @ApiEnvelopeResponse(ShopDetailDto, { description: 'The shop.' })
  @ApiErrorResponses(...DENIED, NOT_FOUND)
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ShopAssignmentParamDto,
  ): Promise<ShopDetailDto> {
    return this.shops.unassign(user, params.id, params.userId);
  }
}
