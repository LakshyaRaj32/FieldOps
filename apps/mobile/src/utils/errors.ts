/**
 * Application error model.
 *
 * Every failure that can reach the UI is normalized into an AppError, so screens handle
 * one shape instead of fetch errors, HTTP bodies and thrown exceptions separately.
 * `message` is safe to show to users. `detail` is for logs and diagnostics only.
 */

import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { ApiErrorCode, ApiErrorDetail } from '@fieldops/types';

export type AppErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'parse'
  | 'config'
  | 'unexpected';

export interface AppError {
  readonly kind: AppErrorKind;
  /** User-facing message. */
  readonly message: string;
  /** HTTP status for `http` errors. */
  readonly status?: number;
  /** Stable machine-readable code from the API error envelope, when present. */
  readonly code?: string;
  /** Per-field validation problems (VALIDATION_ERROR), for showing next to form fields. */
  readonly details?: readonly ApiErrorDetail[];
  /** Correlates the error with server logs (sent as X-Request-Id). */
  readonly requestId?: string;
  /** Technical detail for logs; never shown as the primary message. */
  readonly detail?: string;
}

const MESSAGES = {
  network:
    "Can't reach the FieldOps server. Check your connection and try again.",
  timeout: 'The server took too long to respond. Please try again.',
  parse: "The server sent a response the app couldn't read.",
  config: 'The app is not configured correctly.',
  unexpected: 'Something went wrong. Please try again.',
} as const;

const SESSION_ENDED = 'Your session has expired. Please sign in again.';

/**
 * User-facing copy for API error codes. The app owns its wording: server messages are
 * never shown directly, so a server change can't put technical text in front of users.
 */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  EMAIL_ALREADY_REGISTERED:
    'An account with this email already exists. Try signing in instead.',
  ACCOUNT_DISABLED:
    'This account has been disabled. Contact your administrator.',
  VALIDATION_ERROR: 'Some fields are missing or invalid.',
  UNAUTHENTICATED: SESSION_ENDED,
  ACCESS_TOKEN_EXPIRED: SESSION_ENDED,
  ACCESS_TOKEN_INVALID: SESSION_ENDED,
  REFRESH_TOKEN_INVALID: SESSION_ENDED,
  REFRESH_TOKEN_REUSED:
    'For your security you were signed out. Please sign in again.',
  SESSION_REVOKED: 'You were signed out. Please sign in again.',
  SESSION_EXPIRED: SESSION_ENDED,
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'The requested item could not be found.',
  INVALID_STATUS_TRANSITION:
    "That action isn't possible for this job anymore. The job has been refreshed.",
  JOB_NOT_EDITABLE: 'This job can no longer be changed that way.',
  INVALID_ASSIGNEE:
    "That worker can't be assigned jobs. Choose another worker.",
  VERSION_CONFLICT:
    'Someone else changed this job. The latest version has been loaded; please try again.',
  PAYLOAD_TOO_LARGE: 'The photo is larger than 10 MB.',
  UNSUPPORTED_FILE_TYPE: 'Only JPEG and PNG photos can be attached.',
  EVIDENCE_LIMIT_REACHED: 'This job already has the maximum number of photos.',
};

function messageForStatus(status: number): string {
  if (status === 401) {
    return SESSION_ENDED;
  }
  if (status === 403) {
    return "You don't have permission to do that.";
  }
  if (status === 404) {
    return 'The requested item could not be found.';
  }
  if (status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (status >= 500) {
    return 'The server ran into a problem. Please try again shortly.';
  }
  return `The request failed (status ${status}).`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readDetails(
  record: Record<string, unknown>,
): readonly ApiErrorDetail[] | undefined {
  const { details: value } = record;
  if (!Array.isArray(value)) {
    return undefined;
  }
  const details = value.flatMap(item => {
    if (!isRecord(item)) {
      return [];
    }
    const field = readString(item, 'field');
    const message = readString(item, 'message');
    return field !== undefined && message !== undefined
      ? [{ field, message }]
      : [];
  });
  return details.length > 0 ? details : undefined;
}

/** Builds an AppError, omitting undefined optional fields (exactOptionalPropertyTypes). */
function makeError(
  kind: AppErrorKind,
  message: string,
  extras: {
    status?: number | undefined;
    code?: string | undefined;
    details?: readonly ApiErrorDetail[] | undefined;
    requestId?: string | undefined;
    detail?: string | undefined;
  } = {},
): AppError {
  return {
    kind,
    message,
    ...(extras.status !== undefined && { status: extras.status }),
    ...(extras.code !== undefined && { code: extras.code }),
    ...(extras.details !== undefined && { details: extras.details }),
    ...(extras.requestId !== undefined && { requestId: extras.requestId }),
    ...(extras.detail !== undefined && { detail: extras.detail }),
  };
}

const APP_ERROR_KINDS: readonly string[] = [
  'network',
  'timeout',
  'http',
  'parse',
  'config',
  'unexpected',
];

export function isAppError(value: unknown): value is AppError {
  if (!isRecord(value)) {
    return false;
  }
  const { kind, message } = value;
  return (
    typeof kind === 'string' &&
    APP_ERROR_KINDS.includes(kind) &&
    typeof message === 'string'
  );
}

export function isFetchBaseQueryError(
  value: unknown,
): value is FetchBaseQueryError {
  if (!isRecord(value) || !('status' in value)) {
    return false;
  }
  const { status } = value;
  return (
    typeof status === 'number' ||
    status === 'FETCH_ERROR' ||
    status === 'PARSING_ERROR' ||
    status === 'TIMEOUT_ERROR' ||
    status === 'CUSTOM_ERROR'
  );
}

export function fromFetchBaseQueryError(
  error: FetchBaseQueryError,
  requestId?: string,
): AppError {
  if (typeof error.status === 'number') {
    // The API error envelope: { success: false, error: { code, message, details, requestId } }.
    const envelope = isRecord(error.data)
      ? readRecord(error.data, 'error')
      : undefined;
    const code = envelope && readString(envelope, 'code');
    const knownMessage =
      code !== undefined ? CODE_MESSAGES[code as ApiErrorCode] : undefined;
    return makeError('http', knownMessage ?? messageForStatus(error.status), {
      status: error.status,
      code,
      details: envelope && readDetails(envelope),
      requestId: (envelope && readString(envelope, 'requestId')) ?? requestId,
      detail: envelope && readString(envelope, 'message'),
    });
  }

  switch (error.status) {
    case 'FETCH_ERROR':
      return makeError('network', MESSAGES.network, {
        requestId,
        detail: error.error,
      });
    case 'TIMEOUT_ERROR':
      return makeError('timeout', MESSAGES.timeout, {
        requestId,
        detail: error.error,
      });
    case 'PARSING_ERROR':
      return makeError('parse', MESSAGES.parse, {
        status: error.originalStatus,
        requestId,
        detail: error.error,
      });
    case 'CUSTOM_ERROR':
      return makeError('unexpected', MESSAGES.unexpected, {
        requestId,
        detail: error.error,
      });
  }
}

/** Normalizes anything that was thrown or returned as an error into an AppError. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (isFetchBaseQueryError(error)) {
    return fromFetchBaseQueryError(error);
  }
  if (error instanceof Error) {
    return makeError('unexpected', MESSAGES.unexpected, {
      detail: `${error.name}: ${error.message}`,
    });
  }
  // RTK Query's SerializedError (from exceptions thrown inside queries) is a plain object.
  if (isRecord(error)) {
    return makeError('unexpected', MESSAGES.unexpected, {
      detail: readString(error, 'message'),
    });
  }
  return makeError('unexpected', MESSAGES.unexpected, {
    detail: typeof error === 'string' ? error : undefined,
  });
}

export function configError(detail: string): AppError {
  return makeError('config', MESSAGES.config, { detail });
}

/** A successful response whose body is not what the app expected. */
export function parseError(detail: string, requestId?: string): AppError {
  return makeError('parse', MESSAGES.parse, { detail, requestId });
}

/** The first server-reported problem for a form field, if any. */
export function fieldError(
  error: AppError | undefined,
  field: string,
): string | undefined {
  return error?.details?.find(detail => detail.field === field)?.message;
}
