import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

/**
 * Realtime delivery over WebSockets (Socket.IO). Listens to domain events and forwards them
 * as hints to the connections allowed to see them. Holds no state beyond open connections.
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
