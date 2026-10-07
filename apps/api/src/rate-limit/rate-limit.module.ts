import { Module } from '@nestjs/common';

import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimiterService } from './rate-limiter.service.js';

/** Request rate limiting (docs/rate-limiting.md). The guard is registered in AppModule. */
@Module({
  providers: [RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard],
})
export class RateLimitModule {}
