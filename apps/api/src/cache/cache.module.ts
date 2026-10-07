import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';

/** Cache-aside over Redis, available to every module (docs/redis.md). */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
