import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { BackgroundTasks } from '../queue/background-tasks.service.js';
import { SessionsService } from './sessions.service.js';

export const SESSION_PURGE_TASK = 'sessions.purge-expired';

const DAY_MS = 86_400_000;

/**
 * Daily: deletes sessions that expired more than a refresh-token lifetime ago. Until then
 * an old refresh token still gets its precise answer (SESSION_EXPIRED, SESSION_REVOKED);
 * after it, REFRESH_TOKEN_INVALID, which the app handles the same way (sign in again).
 */
@Injectable()
export class SessionsMaintenance implements OnModuleInit {
  private readonly logger = new Logger(SessionsMaintenance.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly tasks: BackgroundTasks,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.tasks.define({
      name: SESSION_PURGE_TASK,
      queue: 'maintenance',
      attempts: 3,
      everyMs: DAY_MS,
      run: async () => {
        await this.purge();
      },
    });
  }

  async purge(now: Date = new Date()): Promise<number> {
    const graceMs = this.config.auth.refreshTokenTtlSeconds * 1000;
    const deleted = await this.sessions.purgeExpired(
      new Date(now.getTime() - graceMs),
    );
    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired session(s)`);
    }
    return deleted;
  }
}
