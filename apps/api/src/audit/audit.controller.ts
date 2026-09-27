import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { AuditEntry, AuditPage } from '@fieldops/types';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { UserSummaryDto } from '../common/dto/user-summary.dto.js';
import { Role } from '../users/role.js';
import { AuditService } from './audit.service.js';

class AuditQueryDto {
  @ApiPropertyOptional({ example: 'payment' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  readonly entityType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  readonly entityId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'SUPER_ADMIN only.' })
  @IsOptional()
  @IsUUID('all')
  readonly organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}

class AuditEntryDto implements AuditEntry {
  @ApiProperty({ format: 'uuid' }) readonly id: string;
  @ApiProperty({ example: 'payment.verified' }) readonly action: string;
  @ApiProperty({ example: 'payment' }) readonly entityType: string;
  @ApiProperty({ format: 'uuid' }) readonly entityId: string;
  @ApiProperty() readonly summary: string;
  @ApiProperty({ type: UserSummaryDto, nullable: true })
  readonly actor: UserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) readonly createdAt: string;
}

class AuditPageDto implements AuditPage {
  @ApiProperty({ type: [AuditEntryDto] }) readonly items: AuditEntryDto[];
  @ApiProperty({ type: String, nullable: true }) readonly nextCursor:
    string | null;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.ORGANIZATION_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'The audit log, newest first (ORGANIZATION_ADMIN, SUPER_ADMIN)',
    description:
      "Organization admins read their own organization's log only. Filter by entity to see " +
      "one shop's, order's or payment's history.",
  })
  @ApiEnvelopeResponse(AuditPageDto, { description: 'One page of entries.' })
  @ApiErrorResponses(
    { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
    { status: HttpStatus.FORBIDDEN, description: 'FORBIDDEN' },
  )
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditQueryDto,
  ): Promise<AuditPage> {
    return this.audit.list(user, query);
  }
}
