import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { UsersModule } from '../users/users.module.js';
import { JobsRepository } from './data/jobs.repository.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { MutationsMaintenance } from './mutations-maintenance.js';

/**
 * Operations ("jobs"): every operation type, assignment, the per-type state machine and
 * history, submissions and their verification (through the shops module's ledger), and the
 * child collections the worker adds in the field: notes, photo evidence (bytes in object
 * storage) and messages. Side effects (realtime, notifications) are published as domain
 * events, never called directly.
 */
@Module({
  imports: [UsersModule, ShopsModule, CatalogModule, RealtimeModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository, MutationsMaintenance],
})
export class JobsModule {}
