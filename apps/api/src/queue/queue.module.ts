import { Global, Module } from '@nestjs/common';

import { BackgroundTasks } from './background-tasks.service.js';

/** Background tasks over BullMQ, available to every module (docs/background-tasks.md). */
@Global()
@Module({
  providers: [BackgroundTasks],
  exports: [BackgroundTasks],
})
export class QueueModule {}
