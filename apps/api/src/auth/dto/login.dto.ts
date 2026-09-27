import { ApiProperty } from '@nestjs/swagger';
import type { LoginRequest } from '@fieldops/types';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH, EmailField } from './fields.js';

export class LoginDto implements LoginRequest {
  @EmailField()
  readonly email: string;

  /**
   * Only presence and an upper bound are checked here. The minimum length is a registration
   * rule; applying it at login would tell an attacker which guesses are pointless.
   */
  @ApiProperty({ example: 'correct horse battery staple', format: 'password' })
  @IsString({ message: 'Password is required.' })
  @IsNotEmpty({ message: 'Password is required.' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'Invalid email or password.' })
  readonly password: string;
}
