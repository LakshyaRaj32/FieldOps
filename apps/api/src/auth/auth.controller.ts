import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ApiEnvelopeResponse,
  ApiErrorResponses,
} from '../common/swagger/api-envelope.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { UserProfileDto } from '../users/dto/user-profile.dto.js';
import { AuthService } from './auth.service.js';
import { AuthResultDto, AuthTokensDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const VALIDATION_FAILED = {
  status: HttpStatus.BAD_REQUEST,
  description: 'VALIDATION_ERROR: invalid or unknown fields.',
};

/**
 * Authentication endpoints under /api/v1/auth.
 *
 * Rate limiting: register, login and refresh are the V11 limiter's first targets
 * (credential stuffing, account enumeration, token brute force). See docs/authentication.md.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a WORKER account and sign in',
    description: 'Returns the new user and a token pair for this device.',
  })
  @ApiEnvelopeResponse(AuthResultDto, {
    status: HttpStatus.CREATED,
    description: 'Account created and signed in.',
  })
  @ApiErrorResponses(VALIDATION_FAILED, {
    status: HttpStatus.CONFLICT,
    description: 'EMAIL_ALREADY_REGISTERED',
  })
  register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AuthResultDto> {
    return this.auth.register(dto, { userAgent });
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Creates a new session (one per device) and returns a token pair.',
  })
  @ApiEnvelopeResponse(AuthResultDto, { description: 'Signed in.' })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    { status: HttpStatus.UNAUTHORIZED, description: 'INVALID_CREDENTIALS' },
    { status: HttpStatus.FORBIDDEN, description: 'ACCOUNT_DISABLED' },
  )
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AuthResultDto> {
    return this.auth.login(dto, { userAgent });
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new access token',
    description:
      'The presented refresh token becomes invalid. Presenting it again is treated as ' +
      'token theft and revokes the whole session (REFRESH_TOKEN_REUSED).',
  })
  @ApiEnvelopeResponse(AuthTokensDto, { description: 'New token pair.' })
  @ApiErrorResponses(VALIDATION_FAILED, {
    status: HttpStatus.UNAUTHORIZED,
    description:
      'REFRESH_TOKEN_INVALID, REFRESH_TOKEN_REUSED, SESSION_REVOKED or SESSION_EXPIRED',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sign out this device (revokes the current session)',
  })
  @ApiNoContentResponse({ description: 'Session revoked.' })
  @ApiErrorResponses({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing, invalid or expired access token.',
  })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user.sessionId);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiEnvelopeResponse(UserProfileDto, { description: 'Current user.' })
  @ApiErrorResponses({
    status: HttpStatus.UNAUTHORIZED,
    description:
      'UNAUTHENTICATED, ACCESS_TOKEN_EXPIRED, ACCESS_TOKEN_INVALID, SESSION_REVOKED or SESSION_EXPIRED',
  })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileDto> {
    return this.auth.me(user.userId);
  }
}
