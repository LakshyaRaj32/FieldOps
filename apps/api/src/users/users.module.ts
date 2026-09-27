import { Module } from '@nestjs/common';

import { PasswordService } from '../auth/password.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * People: the users table, organization membership and teams. PasswordService lives here
 * (it has no dependencies) because administrators create accounts too, not only the auth
 * flows.
 */
@Module({
  controllers: [UsersController, MembersController],
  providers: [UsersService, MembersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
