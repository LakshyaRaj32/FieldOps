import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { PrismaService } from '../../src/database/prisma.service.js';

export interface TestApp {
  readonly app: INestApplication;
  readonly prisma: PrismaService;
  readonly config: AppConfig;
  readonly http: () => ReturnType<typeof request>;
}

/** Boots the real application (same HTTP pipeline as main.ts) against the test database. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({
    logger: ['error', 'warn'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    config,
    http: () => request(app.getHttpServer()),
  };
}

/** Empties every table between tests. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE sessions, users CASCADE');
}
