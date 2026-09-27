import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { MemberDto } from '../users/dto/member.dto.js';
import { Role } from '../users/role.js';
import {
  CreateOrganizationDto,
  NewAccountDto,
  OrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

const DENIED = [
  { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
  { status: HttpStatus.FORBIDDEN, description: 'FORBIDDEN' },
] as const;

/** The platform's organizations, under /api/v1/organizations. SUPER_ADMIN only. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('organizations')
@Roles(Role.SUPER_ADMIN)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'List organizations (SUPER_ADMIN)' })
  @ApiEnvelopeResponse(OrganizationDto, {
    description: 'Every organization, by name.',
    isArray: true,
  })
  @ApiErrorResponses(...DENIED)
  list(): Promise<OrganizationDto[]> {
    return this.organizations.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create an organization, optionally with its first admin (SUPER_ADMIN)',
  })
  @ApiEnvelopeResponse(OrganizationDto, {
    status: HttpStatus.CREATED,
    description: 'The organization.',
  })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.CONFLICT,
    description: 'ALREADY_EXISTS (name), EMAIL_ALREADY_REGISTERED (admin)',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.organizations.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One organization (SUPER_ADMIN)' })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  get(@Param() params: IdParamDto): Promise<OrganizationDto> {
    return this.organizations.get(params.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change an organization (SUPER_ADMIN)' })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.organizations.update(user, params.id, dto);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend an organization (SUPER_ADMIN)',
    description:
      'Its members can no longer sign in or use the API (ORGANIZATION_SUSPENDED). Data is kept.',
  })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<OrganizationDto> {
    return this.organizations.setSuspended(user, params.id, true);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a suspended organization (SUPER_ADMIN)',
  })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<OrganizationDto> {
    return this.organizations.setSuspended(user, params.id, false);
  }

  @Post(':id/admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an organization admin account (SUPER_ADMIN)',
    description:
      'To disable an admin, their organization deactivates them (PATCH /organization/members/:id).',
  })
  @ApiEnvelopeResponse(MemberDto, {
    status: HttpStatus.CREATED,
    description: 'The new admin.',
  })
  @ApiErrorResponses(...DENIED, {
    status: HttpStatus.CONFLICT,
    description: 'EMAIL_ALREADY_REGISTERED',
  })
  createAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: NewAccountDto,
  ): Promise<MemberDto> {
    return this.organizations.createAdmin(user, params.id, dto);
  }
}

/** The caller's own organization, under /api/v1/organization. */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
export class OwnOrganizationController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'My organization (any member)' })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  get(@CurrentUser() user: AuthenticatedUser): Promise<OrganizationDto> {
    return this.organizations.getOwn(user);
  }

  @Patch()
  @Roles(Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary:
      'Change my organization’s profile and settings (ORGANIZATION_ADMIN)',
  })
  @ApiEnvelopeResponse(OrganizationDto, { description: 'The organization.' })
  @ApiErrorResponses(...DENIED)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationDto> {
    return this.organizations.updateOwn(user, dto);
  }
}
