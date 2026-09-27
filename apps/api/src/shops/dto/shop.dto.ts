import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AssignShopRequest,
  CreateShopRequest,
  Shop,
  ShopAssignee,
  ShopDetail,
  UpdateShopRequest,
} from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { trimmed } from '../../auth/dto/fields.js';
import { UserSummaryDto } from '../../common/dto/user-summary.dto.js';
import {
  LimitField,
  NullableOnly,
  OptionalText,
} from '../../common/dto/fields.js';
import { ShopStatus } from '../../generated/prisma/client.js';
import { GeoPointDto } from '../../jobs/dto/job-fields.js';
import { Role } from '../../users/role.js';
import type { ShopDetailRecord, ShopRecord } from '../shops.service.js';

export const SHOP_LIMITS = {
  name: 200,
  ownerName: 200,
  phone: 30,
  email: 254,
  address: 500,
} as const;

function shopFields(row: ShopRecord): Shop {
  return {
    id: row.id,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    location:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: row.latitude, longitude: row.longitude },
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ShopDto implements Shop {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Nike Chandigarh' }) readonly name: string;
  @ApiProperty({ type: String, nullable: true }) readonly ownerName:
    string | null;
  @ApiProperty({ type: String, nullable: true }) readonly phone: string | null;
  @ApiProperty({ type: String, nullable: true }) readonly email: string | null;
  @ApiProperty({ example: 'SCO 12, Sector 17, Chandigarh' })
  readonly address: string;
  @ApiProperty({ type: GeoPointDto, nullable: true })
  readonly location: GeoPointDto | null;
  @ApiProperty({ enum: Object.values(ShopStatus) })
  readonly status: ShopStatus;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
  @ApiProperty({ format: 'date-time' }) readonly updatedAt: string;

  static from(row: ShopRecord): ShopDto {
    return Object.assign(new ShopDto(), shopFields(row));
  }
}

export class ShopAssigneeDto implements ShopAssignee {
  @ApiProperty({ type: UserSummaryDto }) readonly user: UserSummaryDto;
  @ApiProperty({ enum: Object.values(Role) }) readonly role: Role;
  @ApiProperty({ format: 'date-time' }) readonly startedAt: string;
}

export class ShopDetailDto extends ShopDto implements ShopDetail {
  @ApiProperty({ type: [ShopAssigneeDto] })
  readonly managers: ShopAssigneeDto[];
  @ApiProperty({ type: [ShopAssigneeDto] })
  readonly workers: ShopAssigneeDto[];

  static override from(row: ShopDetailRecord): ShopDetailDto {
    const assignees = row.assignments.map(assignment => ({
      user: UserSummaryDto.from(assignment.user),
      role: assignment.user.role,
      startedAt: assignment.startedAt.toISOString(),
    }));
    return Object.assign(new ShopDetailDto(), {
      ...shopFields(row),
      managers: assignees.filter(a => a.role !== Role.WORKER),
      workers: assignees.filter(a => a.role === Role.WORKER),
    } satisfies ShopDetail);
  }
}

export class CreateShopDto implements CreateShopRequest {
  @ApiProperty({ minLength: 1, maxLength: SHOP_LIMITS.name })
  @trimmed()
  @IsString({ message: 'Name is required.' })
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(SHOP_LIMITS.name)
  readonly name: string;

  @OptionalText('Owner name', SHOP_LIMITS.ownerName)
  readonly ownerName?: string;

  @OptionalText('Phone', SHOP_LIMITS.phone)
  readonly phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @trimmed()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(SHOP_LIMITS.email)
  readonly email?: string;

  @ApiProperty({ minLength: 1, maxLength: SHOP_LIMITS.address })
  @trimmed()
  @IsString({ message: 'Address is required.' })
  @MinLength(1, { message: 'Address is required.' })
  @MaxLength(SHOP_LIMITS.address)
  readonly address: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  readonly location?: GeoPointDto;
}

export class UpdateShopDto implements UpdateShopRequest {
  @OptionalText('Name', SHOP_LIMITS.name)
  readonly name?: string;

  @NullableOnly()
  @OptionalText('Owner name', SHOP_LIMITS.ownerName)
  readonly ownerName?: string | null;

  @NullableOnly()
  @OptionalText('Phone', SHOP_LIMITS.phone)
  readonly phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @NullableOnly()
  @trimmed()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(SHOP_LIMITS.email)
  readonly email?: string | null;

  @OptionalText('Address', SHOP_LIMITS.address)
  readonly address?: string;

  @ApiPropertyOptional({ type: GeoPointDto, nullable: true })
  @NullableOnly()
  @ValidateNested()
  @Type(() => GeoPointDto)
  readonly location?: GeoPointDto | null;

  @ApiPropertyOptional({ enum: Object.values(ShopStatus) })
  @IsOptional()
  @IsEnum(ShopStatus)
  readonly status?: ShopStatus;
}

export class AssignShopDto implements AssignShopRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'User must be a valid ID.' })
  readonly userId: string;
}

export class ShopAssignmentParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  readonly id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  readonly userId: string;
}

export class ListShopsQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ALL'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'ALL'])
  readonly status?: 'ACTIVE' | 'ALL';

  @ApiPropertyOptional({ description: 'Name contains (case-insensitive).' })
  @IsOptional()
  @trimmed()
  @IsString()
  @MaxLength(100)
  readonly search?: string;

  @LimitField(500, 200)
  readonly limit?: number;
}
