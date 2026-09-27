import { Global, Module } from '@nestjs/common';

import { DomainEvents } from './domain-events.js';

/** The in-process domain event bus, available to every module. */
@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class EventsModule {}
