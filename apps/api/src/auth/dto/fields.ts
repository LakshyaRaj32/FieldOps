import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Password policy (NIST SP 800-63B): a length requirement instead of composition rules.
 * At least 8 characters; at most 128 so a request cannot make the server hash megabytes.
 * Passwords are never trimmed: every character the user typed counts.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Trims string input; leaves other types for the validators to reject. */
export const trimmed = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

export const EmailField = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({ example: 'worker@example.com', maxLength: 254 }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsString({ message: 'Email is required.' }),
    MaxLength(254, { message: 'Email must be at most 254 characters.' }),
    IsEmail({}, { message: 'Enter a valid email address.' }),
  );

export const PasswordField = (): PropertyDecorator =>
  applyDecorators(
    ApiProperty({
      example: 'correct horse battery staple',
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      format: 'password',
    }),
    IsString({ message: 'Password is required.' }),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    }),
  );
