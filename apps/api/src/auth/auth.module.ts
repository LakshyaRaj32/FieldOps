import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    // No module-wide secret: access and refresh tokens use different secrets, passed on
    // every sign/verify call by TokensService.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    SessionsService,
    JwtStrategy,
    AccessTokenVerifier,
  ],
  // The realtime gateway authenticates WebSocket connections with the same checks.
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
