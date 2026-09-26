import { ApiProperty } from '@nestjs/swagger';
import type { AuthResult, AuthTokens } from '@fieldops/types';

import { UserProfileDto } from '../../users/dto/user-profile.dto.js';

export class AuthTokensDto implements AuthTokens {
  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  readonly tokenType: 'Bearer';

  @ApiProperty({ description: 'Short-lived JWT for the Authorization header.' })
  readonly accessToken: string;

  @ApiProperty({ format: 'date-time' })
  readonly accessTokenExpiresAt: string;

  @ApiProperty({
    description:
      'Single-use token for POST /api/v1/auth/refresh. Every refresh returns a new one; ' +
      'presenting an old one signs the session out.',
  })
  readonly refreshToken: string;

  @ApiProperty({ format: 'date-time' })
  readonly refreshTokenExpiresAt: string;
}

export class AuthResultDto implements AuthResult {
  @ApiProperty({ type: UserProfileDto })
  readonly user: UserProfileDto;

  @ApiProperty({ type: AuthTokensDto })
  readonly tokens: AuthTokensDto;
}
