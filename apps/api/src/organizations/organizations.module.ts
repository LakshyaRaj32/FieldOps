import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';
import {
  OrganizationsController,
  OwnOrganizationController,
} from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

/** Tenants: the platform's organization management and each organization's settings. */
@Module({
  imports: [UsersModule],
  controllers: [OrganizationsController, OwnOrganizationController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
