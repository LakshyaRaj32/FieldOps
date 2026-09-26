import {
  HttpStatus,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import type { ApiErrorDetail } from '@fieldops/types';

import { AppException } from '../errors/app-exception.js';
import { ErrorCode } from '../errors/error-codes.js';

/** Flattens nested class-validator errors into `{ field, message }` pairs. */
export function toErrorDetails(
  errors: readonly ValidationError[],
  parentPath = '',
): ApiErrorDetail[] {
  return errors.flatMap(error => {
    const field =
      parentPath === '' ? error.property : `${parentPath}.${error.property}`;
    const own = Object.values(error.constraints ?? {}).map(message => ({
      field,
      message,
    }));
    return [...own, ...toErrorDetails(error.children ?? [], field)];
  });
}

/**
 * Global validation for every DTO:
 * - unknown properties are rejected (not silently dropped), so clients learn about typos and
 *   mass-assignment attempts such as `"role": "ADMIN"` fail loudly
 * - payloads are transformed into DTO instances (trimming, lower-casing)
 * - submitted values are never echoed back in error messages (passwords)
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: errors =>
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Some fields are missing or invalid.',
        toErrorDetails(errors),
      ),
  });
}
