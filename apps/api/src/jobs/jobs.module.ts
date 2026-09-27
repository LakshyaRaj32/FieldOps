import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module.js';
import { JobsRepository } from './data/jobs.repository.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/**
 * Jobs: the job model, assignment, the status state machine and job history, plus the job's
 * child collections the worker adds in the field: notes, photo evidence (bytes in object
 * storage) and the job's messages. Side effects (realtime, notifications) are published as
 * domain events, never called directly.
 */
@Module({
  imports: [UsersModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository],
})
export class JobsModule {}
