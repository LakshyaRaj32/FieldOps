import { ApiProperty } from '@nestjs/swagger';
import type { RefreshTokenRequest } from '@fieldops/types';
import { IsJWT, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto implements RefreshTokenRequest {
  @ApiProperty({
    description:
      'The refresh token from login, register or the previous refresh.',
  })
  @IsString({ message: 'Refresh token is required.' })
  @MaxLength(2048, { message: 'Refresh token is invalid.' })
  @IsJWT({ message: 'Refresh token is invalid.' })
  readonly refreshToken: string;
}
