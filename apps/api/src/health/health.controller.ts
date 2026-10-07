import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator.js';
import { AppException } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator.js';
import { RedisService, type RedisStatus } from '../redis/redis.service.js';

interface HealthStatus {
  readonly status: 'ok';
}

interface ReadinessStatus extends HealthStatus {
  /**
   * Informational: Redis is optional (the API works without it), so readiness does not
   * depend on it.
   */
  readonly redis: RedisStatus;
}

/**
 * Health checks for the hosting platform and the mobile diagnostics panel. They live outside
 * /api/v1 (they are not part of the versioned API) and are public.
 */
@ApiTags('health')
@Public()
@SkipRateLimit()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The process is up and serving HTTP. Never touches dependencies. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness' })
  @ApiOkResponse({ description: 'The process is running.' })
  live(): HealthStatus {
    return { status: 'ok' };
  }

  /** The process can serve real traffic: the database answers. Also reports Redis. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness (checks PostgreSQL)' })
  @ApiOkResponse({ description: 'The database is reachable.' })
  async ready(): Promise<ReadinessStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', redis: this.redis.status() };
    } catch (error) {
      this.logger.error(
        'Readiness check failed: database unreachable',
        error instanceof Error ? error.message : String(error),
      );
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'The service is temporarily unavailable.',
      );
    }
  }
}
