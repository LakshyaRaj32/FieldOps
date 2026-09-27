import { Module } from '@nestjs/common';

import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * The audit log. Other modules write to it with writeAudit() inside their own transactions
 * (audit.ts); this module serves the read side.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
