import { HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '@fieldops/types';

import { AppException } from './app-exception.js';
import { ErrorCode } from './error-codes.js';

/**
 * Failures of the business rules, with messages people can act on. They never expose a
 * database message, a constraint name or whether a row exists in another organization: a
 * resource outside the caller's organization or scope is always "not found".
 */
export const BusinessErrors = {
  /** Also for rows of another organization or outside the caller's scope. */
  notFound: (what: string) =>
    new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      `${what} not found.`,
    ),
  /** A referenced shop, order, product, manager or worker can't be used for this. */
  invalidReference: (field: string, message: string) =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.INVALID_REFERENCE,
      message,
      [{ field, message }],
    ),
  invalid: (field: string, message: string) =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Some fields are missing or invalid.',
      [{ field, message }],
    ),
  alreadyExists: (field: string, message: string) =>
    new AppException(HttpStatus.CONFLICT, ErrorCode.ALREADY_EXISTS, message, [
      { field, message },
    ]),
  conflict: (message: string) =>
    new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message),
  requirementsNotMet: (details: readonly ApiErrorDetail[]) =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.REQUIREMENTS_NOT_MET,
      details.length === 1 && details[0] !== undefined
        ? `Can't submit yet: ${lowerFirst(details[0].message)}`
        : "Can't submit yet: some required information is missing.",
      details,
    ),
  amountExceedsBalance: (field: string, message: string) =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.AMOUNT_EXCEEDS_BALANCE,
      message,
      [{ field, message }],
    ),
} as const;

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]?.toLowerCase() + text.slice(1);
}
