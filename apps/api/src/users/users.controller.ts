import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UserProfileDto } from './dto/user-profile.dto.js';
import { WorkerSummaryDto } from './dto/worker-summary.dto.js';
import { Role } from './role.js';
import { UsersService } from './users.service.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_WORKERS_LIMIT = 100;

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Admin-only user list. Also the reference example of the role guard: workers and managers
   * receive 403, unauthenticated callers 401.
   */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List users (ADMIN only)' })
  @ApiEnvelopeResponse(UserProfileDto, {
    description: 'Users, newest first.',
    isArray: true,
  })
  @ApiErrorResponses(
    { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
    { status: HttpStatus.FORBIDDEN, description: 'Caller is not an admin.' },
  )
  async list(@Query() query: ListUsersQueryDto): Promise<UserProfileDto[]> {
    const users = await this.users.list(query.limit ?? DEFAULT_LIMIT);
    return users.map(user => UserProfileDto.fromUser(user));
  }

  /**
   * Workers a job can be assigned to. Managers need this to assign jobs but must not get the
   * admin user list, so it returns only active WORKERs and only the fields needed to choose.
   */
  @Get('workers')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'List assignable workers (MANAGER, ADMIN)' })
  @ApiEnvelopeResponse(WorkerSummaryDto, {
    description: 'Active workers, by name.',
    isArray: true,
  })
  @ApiErrorResponses(
    { status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated.' },
    { status: HttpStatus.FORBIDDEN, description: 'Caller is a worker.' },
  )
  async listWorkers(
    @Query() query: ListUsersQueryDto,
  ): Promise<WorkerSummaryDto[]> {
    const workers = await this.users.listActiveWorkers(
      query.limit ?? DEFAULT_WORKERS_LIMIT,
    );
    return workers.map(worker => WorkerSummaryDto.fromUser(worker));
  }
}
