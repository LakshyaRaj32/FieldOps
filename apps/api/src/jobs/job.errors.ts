import { HttpStatus } from '@nestjs/common';

import { AppException } from '../common/errors/app-exception.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { JobStatus } from './job-enums.js';

const STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Factories for the failures the jobs module raises, so codes and messages stay consistent. */
export const JobErrors = {
  /** Also used for jobs the caller may not see, so their existence is not revealed. */
  notFound: () =>
    new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Job not found.',
    ),
  invalidTransition: (action: string, status: JobStatus) =>
    new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATUS_TRANSITION,
      `A job that is ${STATUS_LABELS[status]} can't be ${action}.`,
    ),
  notEditable: (message: string) =>
    new AppException(HttpStatus.CONFLICT, ErrorCode.JOB_NOT_EDITABLE, message),
  invalidAssignee: () =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.INVALID_ASSIGNEE,
      "The selected worker doesn't exist or can't be assigned jobs.",
    ),
  idempotencyKeyReused: () =>
    new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      'This request ID was already used for a different request.',
    ),
  versionConflict: () =>
    new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.VERSION_CONFLICT,
      'The job was changed by someone else. Reload it and try again.',
    ),
} as const;
