import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/** One Prisma client (and connection pool) for the whole process. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
