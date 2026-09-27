import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import {
  CreateMemberDto,
  ListMembersQueryDto,
  MemberDto,
  SetManagerDto,
  UpdateMemberDto,
} from './dto/member.dto.js';
import { MembersService } from './members.service.js';
import { Role } from './role.js';

const COMMON = [
  { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
  {
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN (not an organization admin); NOT_IN_ORGANIZATION.',
  },
] as const;

/**
 * The organization's people, under /api/v1/organization/members. ORGANIZATION_ADMIN only;
 * always the caller's own organization.
 */
@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization/members')
@Roles(Role.ORGANIZATION_ADMIN)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'List members (optionally one role)' })
  @ApiEnvelopeResponse(MemberDto, { description: 'Members.', isArray: true })
  @ApiErrorResponses(...COMMON)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMembersQueryDto,
  ): Promise<MemberDto[]> {
    return this.members.list(user, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a member account',
    description:
      'The person signs in with the given initial password and should change it ' +
      '(POST /auth/change-password). Workers can be put in a team at once.',
  })
  @ApiEnvelopeResponse(MemberDto, {
    status: HttpStatus.CREATED,
    description: 'The new member.',
  })
  @ApiErrorResponses(
    ...COMMON,
    { status: HttpStatus.CONFLICT, description: 'EMAIL_ALREADY_REGISTERED' },
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description: 'INVALID_REFERENCE: the manager is not an active manager.',
    },
  )
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMemberDto,
  ): Promise<MemberDto> {
    return this.members.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One member' })
  @ApiEnvelopeResponse(MemberDto, { description: 'The member.' })
  @ApiErrorResponses(...COMMON, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND (also for people of other organizations)',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
  ): Promise<MemberDto> {
    return this.members.get(user, params.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a member (name, role, active, organization-wide access)',
    description:
      'Deactivating blocks sign-in and every request at once. Admins cannot change their ' +
      'own role or deactivate themselves.',
  })
  @ApiEnvelopeResponse(MemberDto, { description: 'The member.' })
  @ApiErrorResponses(...COMMON, {
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.members.update(user, params.id, dto);
  }

  @Put(':id/manager')
  @ApiOperation({
    summary: "Move a worker to a manager's team (null: no team)",
    description:
      'Ends the current team membership and starts a new one; the history is kept.',
  })
  @ApiEnvelopeResponse(MemberDto, { description: 'The worker.' })
  @ApiErrorResponses(...COMMON, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'INVALID_REFERENCE: not a worker, or not an active manager.',
  })
  setManager(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: IdParamDto,
    @Body() dto: SetManagerDto,
  ): Promise<MemberDto> {
    return this.members.setManager(user, params.id, dto.managerId);
  }
}
