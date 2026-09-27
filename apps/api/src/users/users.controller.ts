import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessService } from '../access/access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import { orgScope } from '../common/tenancy/scope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { MemberDto } from './dto/member.dto.js';
import { WorkerSummaryDto } from './dto/worker-summary.dto.js';
import { Role } from './role.js';
import { UsersService } from './users.service.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_WORKERS_LIMIT = 100;

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly access: AccessService,
  ) {}

  /**
   * The organization's people (ORGANIZATION_ADMIN). Kept from Phase 1 for compatibility; the
   * full member management API is /organization/members.
   */
  @Get()
  @Roles(Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: "List the organization's users (ORGANIZATION_ADMIN)",
  })
  @ApiEnvelopeResponse(MemberDto, {
    description: 'Members of the caller’s organization.',
    isArray: true,
  })
  @ApiErrorResponses(
    { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
    { status: HttpStatus.FORBIDDEN, description: 'Caller is not an admin.' },
  )
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<MemberDto[]> {
    const scope = orgScope(user);
    const rows = await this.users.listMembers(scope.organizationId, {
      limit: query.limit ?? DEFAULT_LIMIT,
    });
    return rows.map(row => MemberDto.from(row));
  }

  /**
   * Workers the caller can assign operations to: their team for a scoped manager, every
   * active worker of the organization otherwise. Only the fields needed to choose.
   */
  @Get('workers')
  @Roles(Role.MANAGER, Role.ORGANIZATION_ADMIN)
  @ApiOperation({
    summary: 'List assignable workers (MANAGER, ORGANIZATION_ADMIN)',
  })
  @ApiEnvelopeResponse(WorkerSummaryDto, {
    description: 'Active workers in the caller’s scope, by name.',
    isArray: true,
  })
  @ApiErrorResponses(
    { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
    { status: HttpStatus.FORBIDDEN, description: 'Caller is a worker.' },
  )
  async listWorkers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ): Promise<WorkerSummaryDto[]> {
    const scope = orgScope(user);
    const workers = await this.users.listActiveWorkers(
      scope.organizationId,
      await this.access.workerFilter(scope),
      query.limit ?? DEFAULT_WORKERS_LIMIT,
    );
    return workers.map(worker => WorkerSummaryDto.fromUser(worker));
  }
}
