import {
  Body,
  Controller,
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
import { CatalogService } from './catalog.service.js';
import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductDto,
  UpdateProductDto,
} from './dto/product.dto.js';

const DENIED = [
  { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
  {
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN; NOT_IN_ORGANIZATION',
  },
] as const;

/** The organization's products, under /api/v1/products. */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Roles(Role.WORKER, Role.MANAGER, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'The catalog (any member), by name' })
  @ApiEnvelopeResponse(ProductDto, { description: 'Products.', isArray: true })
  @ApiErrorResponses(...DENIED)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductDto[]> {
    return this.catalog.list(user, query);
  }

  @Post()
  @Roles(Role.ORGANIZATION_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a product (ORGANIZATION_ADMIN)' })
  @ApiEnvelopeResponse(ProductDto, {
    status: HttpStatus.CREATED,
    description: 'The product.',
  })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.CONFLICT,
    description: 'ALREADY_EXISTS: the SKU is taken.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ): Promise<ProductDto> {
    return this.catalog.create(user, dto);
  }

  @Get(':id')
  @Roles(Role.WORKER, Role.MANAGER, Role.ORGANIZATION_ADMIN)
  @ApiOperation({ summary: 'One product' })
  @ApiEnvelopeResponse(ProductDto, { description: 'The product.' })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<ProductDto> {
    return this.catalog.get(user, params.id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'Change a product (ORGANIZATION_ADMIN)',
    description:
      'A price change applies to new orders only. Archiving stops new orders, deliveries and counts.',
  })
  @ApiEnvelopeResponse(ProductDto, { description: 'The product.' })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.catalog.update(user, params.id, dto);
  }
}
