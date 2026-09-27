import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateProductRequest,
  Product,
  UpdateProductRequest,
} from '@fieldops/types';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { trimmed } from '../../auth/dto/fields.js';
import {
  AmountField,
  LimitField,
  NullableOnly,
  OptionalText,
} from '../../common/dto/fields.js';
import { toAmount } from '../../common/money.js';
import {
  ProductStatus,
  type Product as ProductRow,
} from '../../generated/prisma/client.js';

export class ProductDto implements Product {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Air Zoom Pegasus 41' }) readonly name: string;
  @ApiProperty({ example: 'NK-PEG41-BLK-42' }) readonly sku: string;
  @ApiProperty({ type: String, nullable: true }) readonly category:
    string | null;
  @ApiProperty({ description: 'Minor units.', example: 1_199_500 })
  readonly unitPrice: number;
  @ApiProperty({ enum: Object.values(ProductStatus) })
  readonly status: ProductStatus;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
  @ApiProperty({ format: 'date-time' }) readonly updatedAt: string;

  static from(row: ProductRow): ProductDto {
    return Object.assign(new ProductDto(), {
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category,
      unitPrice: toAmount(row.unitPrice),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies Product);
  }
}

export class CreateProductDto implements CreateProductRequest {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @trimmed()
  @IsString({ message: 'Name is required.' })
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(200)
  readonly name: string;

  @ApiProperty({ minLength: 1, maxLength: 64, example: 'NK-PEG41-BLK-42' })
  @trimmed()
  @IsString({ message: 'SKU is required.' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/, {
    message: 'SKU may contain letters, digits and . _ - / (at most 64).',
  })
  readonly sku: string;

  @OptionalText('Category', 100)
  readonly category?: string;

  @AmountField('Unit price', { min: 0 })
  readonly unitPrice: number;
}

export class UpdateProductDto implements UpdateProductRequest {
  @OptionalText('Name', 200)
  readonly name?: string;

  @NullableOnly()
  @OptionalText('Category', 100)
  readonly category?: string | null;

  @AmountField('Unit price', { min: 0, required: false })
  readonly unitPrice?: number;

  @ApiPropertyOptional({ enum: Object.values(ProductStatus) })
  @IsOptional()
  @IsEnum(ProductStatus)
  readonly status?: ProductStatus;
}

export class ListProductsQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ALL'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'ALL'])
  readonly status?: 'ACTIVE' | 'ALL';

  @LimitField(500, 200)
  readonly limit?: number;
}
