import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '@fieldops/types';

import { ErrorCode, type ApiErrorCode } from './error-codes.js';

/**
 * An expected, client-facing failure: a stable code, a user-safe message and an HTTP
 * status. The global exception filter turns it into the error envelope. Anything that is
 * not an AppException (or a Nest HttpException) is treated as an internal error.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: readonly ApiErrorDetail[],
  ) {
    super(message, status);
  }
}

/** Factories for the failures the auth flows raise, so messages stay consistent. */
export const AuthErrors = {
  invalidCredentials: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid email or password.',
    ),
  accountDisabled: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.ACCOUNT_DISABLED,
      'This account has been disabled.',
    ),
  emailAlreadyRegistered: () =>
    new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.EMAIL_ALREADY_REGISTERED,
      'An account with this email already exists.',
    ),
  unauthenticated: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHENTICATED,
      'Authentication is required.',
    ),
  accessTokenExpired: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.ACCESS_TOKEN_EXPIRED,
      'The access token has expired.',
    ),
  accessTokenInvalid: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.ACCESS_TOKEN_INVALID,
      'The access token is invalid.',
    ),
  refreshTokenInvalid: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.REFRESH_TOKEN_INVALID,
      'The refresh token is invalid or has expired.',
    ),
  refreshTokenReused: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.REFRESH_TOKEN_REUSED,
      'This refresh token has already been used. The session has been signed out.',
    ),
  sessionRevoked: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.SESSION_REVOKED,
      'This session has been signed out.',
    ),
  sessionExpired: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.SESSION_EXPIRED,
      'This session has expired.',
    ),
  forbidden: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      "You don't have permission to do that.",
    ),
} as const;
