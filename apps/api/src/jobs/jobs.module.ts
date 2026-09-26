import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';
import { JobsRepository } from './data/jobs.repository.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/** Jobs: the job model, assignment, the status state machine and job history. */
@Module({
  imports: [UsersModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository],
})
export class JobsModule {}
