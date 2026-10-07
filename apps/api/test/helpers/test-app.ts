import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import {
  APP_CONFIG,
  parseAppConfig,
  type AppConfig,
} from '../../src/config/app-config.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushResult,
  type PushSender,
} from '../../src/notifications/push/push-sender.js';

/**
 * Stands in for FCM (an external service is the one thing E2E tests fake). Records every
 * push and answers `invalid_token` for tokens listed in `invalidTokens`.
 */
export class RecordingPushSender implements PushSender {
  readonly sent: { token: string; message: PushMessage }[] = [];
  readonly invalidTokens = new Set<string>();

  send(token: string, message: PushMessage): Promise<PushResult> {
    if (this.invalidTokens.has(token)) {
      return Promise.resolve('invalid_token');
    }
    this.sent.push({ token, message });
    return Promise.resolve('sent');
  }

  reset(): void {
    this.sent.length = 0;
    this.invalidTokens.clear();
  }
}

export interface TestApp {
  readonly app: INestApplication;
  readonly prisma: PrismaService;
  readonly config: AppConfig;
  readonly push: RecordingPushSender;
  readonly http: () => ReturnType<typeof request>;
  /** Set when created with `listen: true` (WebSocket tests need a real port). */
  readonly url: string | undefined;
}

/** Boots the real application (same HTTP pipeline as main.ts) against the test database. */
export async function createTestApp(
  options: {
    readonly listen?: boolean;
    /** Adjusts the configuration parsed from TEST_ENV (rate-limit tests). */
    readonly configure?: (config: AppConfig) => AppConfig;
  } = {},
): Promise<TestApp> {
  const push = new RecordingPushSender();
  const configure = options.configure ?? ((config: AppConfig) => config);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PUSH_SENDER)
    .useValue(push)
    .overrideProvider(APP_CONFIG)
    .useFactory({ factory: () => configure(parseAppConfig(process.env)) })
    .compile();

  const app = moduleRef.createNestApplication({
    logger: ['error', 'warn'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  let url: string | undefined;
  if (options.listen === true) {
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  } else {
    await app.init();
  }

  return {
    app,
    prisma: app.get(PrismaService),
    config,
    push,
    http: () => request(app.getHttpServer()),
    url,
  };
}

/** Empties every table between tests. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, notifications, push_devices, payments, job_lines, job_messages, job_evidence, processed_mutations, job_notes, job_events, job_checklist_items, jobs, order_items, orders, products, shop_assignments, shops, team_memberships, sessions, users, organizations CASCADE',
  );
}

/** The organization the Phase 2-4 suites run in (they predate multi-tenancy). */
export const TEST_ORGANIZATION = 'Test organization';

/**
 * Puts a (self-registered) user into an organization with a role, the way an organization
 * admin would, creating the organization on first use. Returns the organization's ID.
 */
export async function joinOrganization(
  prisma: PrismaService,
  userId: string,
  role: 'WORKER' | 'MANAGER' | 'ORGANIZATION_ADMIN',
  organizationName: string = TEST_ORGANIZATION,
  options: { readonly organizationWideAccess?: boolean } = {},
): Promise<string> {
  const organization = await prisma.organization.upsert({
    where: { name: organizationName },
    create: { name: organizationName },
    update: {},
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      role,
      organizationId: organization.id,
      organizationWideAccess: options.organizationWideAccess ?? false,
    },
  });
  return organization.id;
}

/** Waits until `check` passes (event handlers run after the response is sent). */
export async function eventually(
  check: () => Promise<void> | void,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
