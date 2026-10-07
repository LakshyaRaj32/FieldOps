import {
  RequestMethod,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import {
  REQUEST_ID_HEADER,
  requestContext,
} from './common/middleware/request-context.middleware.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import type { AppConfig } from './config/app-config.js';
import { RATE_LIMIT_HEADERS } from './rate-limit/rate-limit.guard.js';

/**
 * HTTP pipeline shared by main.ts and the E2E tests, so tests exercise exactly what runs in
 * production: routes under /api/v1, validation, the response envelope and error handling.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  // request.ip (rate-limit keys) reads X-Forwarded-For through exactly this many proxies;
  // trusting more would let clients pick their own IP.
  (
    app.getHttpAdapter().getInstance() as {
      set(name: string, value: unknown): void;
    }
  ).set('trust proxy', config.trustProxyHops);

  // Security headers (HSTS, nosniff, frame-ancestors...) and no X-Powered-By.
  app.use(helmet());

  // CORS only matters for browsers; the mobile app is not one. Disabled unless explicit
  // origins are configured (never "*").
  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', REQUEST_ID_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER, ...RATE_LIMIT_HEADERS],
      maxAge: 600,
    });
  }

  app.use(requestContext);

  // /api/v1/... for business endpoints; /health/* stays unversioned for platform probes.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health/{*path}', method: RequestMethod.ALL }],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
}
