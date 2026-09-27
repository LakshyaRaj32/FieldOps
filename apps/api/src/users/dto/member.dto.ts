import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CreateMemberRequest,
  Member,
  OrganizationRole,
  SetManagerRequest,
  UpdateMemberRequest,
} from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { EmailField, PasswordField, trimmed } from '../../auth/dto/fields.js';
import { UserSummaryDto } from '../../common/dto/user-summary.dto.js';
import type { MemberRecord } from '../users.service.js';
import { ORGANIZATION_ROLES, Role } from '../role.js';

const NameField = (label: string): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ minLength: 1, maxLength: 100 }),
    trimmed(),
    IsString({ message: `${label} is required.` }),
    MinLength(1, { message: `${label} is required.` }),
    MaxLength(100, { message: `${label} must be at most 100 characters.` }),
  );

const OptionalNameField = (label: string): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({ minLength: 1, maxLength: 100 }),
    IsOptional(),
    trimmed(),
    IsString({ message: `${label} must be text.` }),
    MinLength(1, { message: `${label} can't be empty.` }),
    MaxLength(100, { message: `${label} must be at most 100 characters.` }),
  );

const ROLE_MESSAGE = `Role must be one of ${ORGANIZATION_ROLES.join(', ')}.`;

export class MemberDto implements Member {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty() readonly email: string;
  @ApiProperty() readonly firstName: string;
  @ApiProperty() readonly lastName: string;
  @ApiProperty({ enum: Object.values(Role) }) readonly role: Role;
  @ApiProperty() readonly isActive: boolean;
  @ApiProperty() readonly organizationWideAccess: boolean;
  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly manager: UserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;

  static from(user: MemberRecord): MemberDto {
    const team = user.teamManagers[0];
    return Object.assign(new MemberDto(), {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      organizationWideAccess: user.organizationWideAccess,
      manager: team === undefined ? null : UserSummaryDto.from(team.manager),
      createdAt: user.createdAt.toISOString(),
    } satisfies Member);
  }
}

export class CreateMemberDto implements CreateMemberRequest {
  @EmailField()
  readonly email: string;

  @PasswordField()
  readonly password: string;

  @NameField('First name')
  readonly firstName: string;

  @NameField('Last name')
  readonly lastName: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsIn(ORGANIZATION_ROLES, { message: ROLE_MESSAGE })
  readonly role: OrganizationRole;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'WORKER: their manager.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Manager must be a valid ID.' })
  readonly managerId?: string;

  @ApiPropertyOptional({ description: 'MANAGER: organization-wide access.' })
  @IsOptional()
  @IsBoolean()
  readonly organizationWideAccess?: boolean;
}

export class UpdateMemberDto implements UpdateMemberRequest {
  @OptionalNameField('First name')
  readonly firstName?: string;

  @OptionalNameField('Last name')
  readonly lastName?: string;

  @ApiPropertyOptional({ enum: ORGANIZATION_ROLES })
  @IsOptional()
  @IsIn(ORGANIZATION_ROLES, { message: ROLE_MESSAGE })
  readonly role?: OrganizationRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readonly organizationWideAccess?: boolean;
}

export class SetManagerDto implements SetManagerRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsUUID('all', { message: 'Manager must be a valid ID or null.' })
  readonly managerId: string | null;
}

export class ListMembersQueryDto {
  @ApiPropertyOptional({ enum: ORGANIZATION_ROLES })
  @IsOptional()
  @IsIn(ORGANIZATION_ROLES, { message: ROLE_MESSAGE })
  readonly role?: OrganizationRole;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  readonly limit?: number;
}
