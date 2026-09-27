import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { AppConfig } from './config/app-config.js';

export const SWAGGER_PATH = 'api/docs';

/**
 * OpenAPI document and Swagger UI at /api/docs (JSON at /api/docs-json). Use "Authorize"
 * with the accessToken from login to call protected endpoints. Disabled in production by
 * default (SWAGGER_ENABLED).
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FieldOps API')
      .setDescription(
        'FieldOps REST API. Every response uses the envelope ' +
          '`{ success: true, data }` or `{ success: false, error: { code, message } }`.',
      )
      .setVersion('v1')
      .addTag('auth', 'Registration, sign-in, token refresh, sign-out')
      .addTag('users', 'User administration and assignable workers')
      .addTag('jobs', 'Jobs: creation, assignment, status actions and history')
      .addTag('health', 'Liveness and readiness probes')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from /api/v1/auth/login or /api/v1/auth/register.',
      })
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    customSiteTitle: `FieldOps API (${config.environment})`,
    swaggerOptions: {
      persistAuthorization: config.environment === 'development',
    },
  });
}
