import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UserProfileDto } from './dto/user-profile.dto.js';
import { Role } from './role.js';
import { UsersService } from './users.service.js';

const DEFAULT_LIMIT = 20;

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
}
