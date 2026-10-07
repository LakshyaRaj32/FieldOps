import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service.js';

/** One Redis connection for the whole process (optional; see RedisService). */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
