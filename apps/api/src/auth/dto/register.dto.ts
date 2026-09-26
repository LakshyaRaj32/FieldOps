import { ApiProperty } from '@nestjs/swagger';
import type { RegisterRequest } from '@fieldops/types';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { EmailField, PasswordField, trimmed } from './fields.js';

export class RegisterDto implements RegisterRequest {
  @EmailField()
  readonly email: string;

  @PasswordField()
  readonly password: string;

  @ApiProperty({ example: 'Asha', minLength: 1, maxLength: 100 })
  @trimmed()
  @IsString({ message: 'First name is required.' })
  @MinLength(1, { message: 'First name is required.' })
  @MaxLength(100, { message: 'First name must be at most 100 characters.' })
  readonly firstName: string;

  @ApiProperty({ example: 'Verma', minLength: 1, maxLength: 100 })
  @trimmed()
  @IsString({ message: 'Last name is required.' })
  @MinLength(1, { message: 'Last name is required.' })
  @MaxLength(100, { message: 'Last name must be at most 100 characters.' })
  readonly lastName: string;
}
