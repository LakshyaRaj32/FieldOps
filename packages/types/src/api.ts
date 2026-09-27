/**
 * The HTTP response envelope shared by the API and the mobile app.
 *
 * Every JSON response from /api/v1 is either `{ success: true, data }` or
 * `{ success: false, error }`. Error `code` values are stable and machine-readable: clients
 * branch on the code, never on the message text. See docs/api.md.
 */

export type ApiErrorCode =
  /** Request body, query or params failed validation. `details` lists the fields. */
  | 'VALIDATION_ERROR'
  /** Malformed request (for example invalid JSON). */
  | 'BAD_REQUEST'
  /** No access token was sent to an endpoint that requires one. */
  | 'UNAUTHENTICATED'
  /** The access token has expired: refresh it and retry. */
  | 'ACCESS_TOKEN_EXPIRED'
  /** The access token is malformed, forged or not an access token. */
  | 'ACCESS_TOKEN_INVALID'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'EMAIL_ALREADY_REGISTERED'
  /** The refresh token is malformed, forged or expired. */
  | 'REFRESH_TOKEN_INVALID'
  /** An already-rotated refresh token was presented; the session has been revoked. */
  | 'REFRESH_TOKEN_REUSED'
  /** The session was signed out or revoked. */
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  /** The job's status does not allow this action (for example completing a PENDING job). */
  | 'INVALID_STATUS_TRANSITION'
  /** The job can no longer be edited or deleted in its current status. */
  | 'JOB_NOT_EDITABLE'
  /** The worker to assign does not exist, is disabled or is not a WORKER. */
  | 'INVALID_ASSIGNEE'
  /** The resource changed since the client read it: refetch and retry. */
  | 'VERSION_CONFLICT'
  /** The Idempotency-Key (or client-generated ID) was already used for a different request. */
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PAYLOAD_TOO_LARGE'
  /** The uploaded file is not one of the accepted types (checked from its bytes). */
  | 'UNSUPPORTED_FILE_TYPE'
  /** The job already has the maximum number of evidence files. */
  | 'EVIDENCE_LIMIT_REACHED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface ApiErrorDetail {
  /** Dotted path of the invalid field, for example `email`. */
  readonly field: string;
  readonly message: string;
}

export interface ApiErrorBody {
  readonly code: ApiErrorCode;
  /** Safe to show to users. Never contains internal details. */
  readonly message: string;
  readonly details?: readonly ApiErrorDetail[];
  /** Correlates the failure with server logs (echo of X-Request-Id). */
  readonly requestId?: string;
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
