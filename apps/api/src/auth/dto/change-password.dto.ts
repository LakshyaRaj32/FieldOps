import { ApiProperty } from '@nestjs/swagger';
import type { ChangePasswordRequest } from '@fieldops/types';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH, PasswordField } from './fields.js';

export class ChangePasswordDto implements ChangePasswordRequest {
  @ApiProperty({ format: 'password' })
  @IsString({ message: 'Current password is required.' })
  @IsNotEmpty({ message: 'Current password is required.' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'Current password is incorrect.' })
  readonly currentPassword: string;

  @PasswordField()
  readonly newPassword: string;
}
