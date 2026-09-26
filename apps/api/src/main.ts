import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { SWAGGER_PATH, setupSwagger } from './swagger.setup.js';

// Local development reads apps/api/.env. Deployed environments inject variables directly.
try {
  process.loadEnvFile();
} catch {
  // No .env file: use the process environment as is.
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  configureApp(app, config);
  if (config.swaggerEnabled) {
    setupSwagger(app, config);
  }
  // Close the database pool cleanly on SIGTERM (platform redeploys, Ctrl+C).
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const logger = new Logger('Bootstrap');
  logger.log(
    `FieldOps API (${config.environment}) listening on http://${config.host}:${config.port}/api/v1`,
  );
  if (config.swaggerEnabled) {
    logger.log(`Swagger UI: http://localhost:${config.port}/${SWAGGER_PATH}`);
  }
}

await bootstrap();
