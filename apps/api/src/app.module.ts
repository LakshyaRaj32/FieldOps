import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessModule } from './access/access.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CacheModule } from './cache/cache.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { RateLimitGuard } from './rate-limit/rate-limit.guard.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ShopsModule } from './shops/shops.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    CacheModule,
    RateLimitModule,
    QueueModule,
    EventsModule,
    StorageModule,
    AccessModule,
    AuditModule,
    HealthModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    CatalogModule,
    ShopsModule,
    JobsModule,
    RealtimeModule,
    NotificationsModule,
  ],
  providers: [
    // Global guards run in this order: authenticate, rate-limit (per user once known),
    // then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
