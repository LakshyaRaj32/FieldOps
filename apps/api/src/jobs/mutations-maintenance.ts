import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { BackgroundTasks } from '../queue/background-tasks.service.js';
import { JobsRepository } from './data/jobs.repository.js';

export const MUTATION_PURGE_TASK = 'sync.purge-processed-mutations';

const DAY_MS = 86_400_000;

/**
 * How long a device command's idempotency key is remembered (docs/synchronization.md).
 * Far longer than any realistic offline period of a phone's outbox.
 */
export const MUTATION_RETENTION_DAYS = 90;

/** Daily: forgets processed device commands older than the retention period. */
@Injectable()
export class MutationsMaintenance implements OnModuleInit {
  private readonly logger = new Logger(MutationsMaintenance.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly tasks: BackgroundTasks,
  ) {}

  onModuleInit(): void {
    this.tasks.define({
      name: MUTATION_PURGE_TASK,
      queue: 'maintenance',
      attempts: 3,
      everyMs: DAY_MS,
      run: async () => {
        await this.purge();
      },
    });
  }

  async purge(now: Date = new Date()): Promise<number> {
    const deleted = await this.jobs.purgeMutations(
      new Date(now.getTime() - MUTATION_RETENTION_DAYS * DAY_MS),
    );
    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} processed device command(s)`);
    }
    return deleted;
  }
}
