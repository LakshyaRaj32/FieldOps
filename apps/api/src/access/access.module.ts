import { Global, Module } from '@nestjs/common';

import { AccessService } from './access.service.js';

/**
 * Scope queries (teams, shop coverage). Global because nearly every business module asks
 * them, and it depends on nothing but the database.
 */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
