import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateOrganizationRequest,
  NewAccount,
  Organization,
  UpdateOrganizationRequest,
} from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { EmailField, PasswordField, trimmed } from '../../auth/dto/fields.js';
import { NullableOnly, OptionalText } from '../../common/dto/fields.js';
import type { Organization as OrganizationRow } from '../../generated/prisma/client.js';

export const ORGANIZATION_LIMITS = {
  name: 200,
  contactName: 200,
  contactEmail: 254,
  contactPhone: 30,
  address: 500,
} as const;

/** Radius limits (also a CHECK constraint). */
export const ARRIVAL_RADIUS = { min: 10, max: 50_000 } as const;

export class OrganizationDto implements Organization {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'Nike Operations' }) readonly name: string;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly status: Organization['status'];
  @ApiProperty({ example: 'INR' }) readonly currency: string;
  @ApiProperty({ example: 'Asia/Kolkata' }) readonly timeZone: string;
  @ApiProperty({ type: String, nullable: true }) readonly contactName:
    string | null;
  @ApiProperty({ type: String, nullable: true }) readonly contactEmail:
    string | null;
  @ApiProperty({ type: String, nullable: true }) readonly contactPhone:
    string | null;
  @ApiProperty({ type: String, nullable: true }) readonly address:
    string | null;
  @ApiProperty({ example: 300 }) readonly arrivalRadiusMeters: number;
  @ApiProperty({ example: 12 }) readonly memberCount: number;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
  @ApiProperty({ format: 'date-time' }) readonly updatedAt: string;

  static from(row: OrganizationRow, memberCount: number): OrganizationDto {
    return Object.assign(new OrganizationDto(), {
      id: row.id,
      name: row.name,
      status: row.status,
      currency: row.currency,
      timeZone: row.timeZone,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      address: row.address,
      arrivalRadiusMeters: row.arrivalRadiusMeters,
      memberCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } satisfies Organization);
  }
}

export class NewAccountDto implements NewAccount {
  @EmailField()
  readonly email: string;

  @PasswordField()
  readonly password: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @trimmed()
  @IsString({ message: 'First name is required.' })
  @MinLength(1, { message: 'First name is required.' })
  @MaxLength(100)
  readonly firstName: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @trimmed()
  @IsString({ message: 'Last name is required.' })
  @MinLength(1, { message: 'Last name is required.' })
  @MaxLength(100)
  readonly lastName: string;
}

const TimeZoneField = (): PropertyDecorator =>
  Matches(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, {
    message: 'Time zone must be an IANA name such as Asia/Kolkata.',
  });

export class CreateOrganizationDto implements CreateOrganizationRequest {
  @ApiProperty({ minLength: 1, maxLength: ORGANIZATION_LIMITS.name })
  @trimmed()
  @IsString({ message: 'Name is required.' })
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(ORGANIZATION_LIMITS.name)
  readonly name: string;

  @OptionalText('Contact name', ORGANIZATION_LIMITS.contactName)
  readonly contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @trimmed()
  @IsEmail({}, { message: 'Enter a valid contact email.' })
  @MaxLength(ORGANIZATION_LIMITS.contactEmail)
  readonly contactEmail?: string;

  @OptionalText('Contact phone', ORGANIZATION_LIMITS.contactPhone)
  readonly contactPhone?: string;

  @OptionalText('Address', ORGANIZATION_LIMITS.address)
  readonly address?: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'Currency must be an ISO 4217 code.' })
  readonly currency?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata', default: 'Asia/Kolkata' })
  @IsOptional()
  @TimeZoneField()
  readonly timeZone?: string;

  @ApiPropertyOptional({
    default: 300,
    minimum: ARRIVAL_RADIUS.min,
    maximum: ARRIVAL_RADIUS.max,
  })
  @IsOptional()
  @IsInt()
  @Min(ARRIVAL_RADIUS.min)
  @Max(ARRIVAL_RADIUS.max)
  readonly arrivalRadiusMeters?: number;

  @ApiPropertyOptional({ type: NewAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewAccountDto)
  readonly admin?: NewAccountDto;
}

export class UpdateOrganizationDto implements UpdateOrganizationRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: ORGANIZATION_LIMITS.name })
  @IsOptional()
  @trimmed()
  @IsString()
  @MinLength(1, { message: "Name can't be empty." })
  @MaxLength(ORGANIZATION_LIMITS.name)
  readonly name?: string;

  @NullableOnly()
  @OptionalText('Contact name', ORGANIZATION_LIMITS.contactName)
  readonly contactName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @NullableOnly()
  @trimmed()
  @IsEmail({}, { message: 'Enter a valid contact email.' })
  @MaxLength(ORGANIZATION_LIMITS.contactEmail)
  readonly contactEmail?: string | null;

  @NullableOnly()
  @OptionalText('Contact phone', ORGANIZATION_LIMITS.contactPhone)
  readonly contactPhone?: string | null;

  @NullableOnly()
  @OptionalText('Address', ORGANIZATION_LIMITS.address)
  readonly address?: string | null;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @TimeZoneField()
  readonly timeZone?: string;

  @ApiPropertyOptional({
    minimum: ARRIVAL_RADIUS.min,
    maximum: ARRIVAL_RADIUS.max,
  })
  @IsOptional()
  @IsInt()
  @Min(ARRIVAL_RADIUS.min)
  @Max(ARRIVAL_RADIUS.max)
  readonly arrivalRadiusMeters?: number;
}
