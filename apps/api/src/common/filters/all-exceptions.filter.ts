import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody, ApiErrorResponse } from '@fieldops/types';
import type { Request, Response } from 'express';

import { AppException } from '../errors/app-exception.js';
import { ErrorCode, type ApiErrorCode } from '../errors/error-codes.js';

interface MappedError {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: ApiErrorBody['details'];
}

/** Safe, generic messages for errors that did not come from our own code. */
const GENERIC: Readonly<Record<number, Omit<MappedError, 'status'>>> = {
  [HttpStatus.BAD_REQUEST]: {
    code: ErrorCode.BAD_REQUEST,
    message: 'The request is malformed.',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: ErrorCode.UNAUTHENTICATED,
    message: 'Authentication is required.',
  },
  [HttpStatus.FORBIDDEN]: {
    code: ErrorCode.FORBIDDEN,
    message: "You don't have permission to do that.",
  },
  [HttpStatus.NOT_FOUND]: {
    code: ErrorCode.NOT_FOUND,
    message: 'The requested resource was not found.',
  },
  [HttpStatus.CONFLICT]: {
    code: ErrorCode.CONFLICT,
    message: 'The request conflicts with the current state.',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    code: ErrorCode.PAYLOAD_TOO_LARGE,
    message: 'The request body is too large.',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'The service is temporarily unavailable.',
  },
};

const INTERNAL: Omit<MappedError, 'status'> = {
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Something went wrong on our side. Please try again.',
};

/** Body-parser errors (invalid JSON, oversized body) are plain errors with a status. */
function httpErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const { status, type } = exception as { status?: unknown; type?: unknown };
  return typeof status === 'number' && typeof type === 'string'
    ? status
    : undefined;
}

function mapException(exception: unknown): MappedError {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      ...(exception.details !== undefined && { details: exception.details }),
    };
  }

  // Framework exceptions (unknown route, body too large...): keep the status, replace the
  // message with a generic one so framework wording and internals never leak.
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : httpErrorStatus(exception);
  if (status !== undefined && status < 500) {
    return { status, ...(GENERIC[status] ?? GENERIC[HttpStatus.BAD_REQUEST]!) };
  }
  if (status === HttpStatus.SERVICE_UNAVAILABLE) {
    return { status, ...GENERIC[HttpStatus.SERVICE_UNAVAILABLE]! };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, ...INTERNAL };
}

/**
 * Turns every exception into the error envelope `{ success: false, error }`.
 *
 * Stack traces, database errors and framework messages never reach the client. Unexpected
 * errors are logged server-side with the request ID; request bodies are never logged,
 * because they can contain passwords and tokens.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const mapped = mapException(exception);

    if (mapped.status >= 500) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.path} (requestId=${request.requestId ?? 'none'})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined && { details: mapped.details }),
        ...(request.requestId !== undefined && {
          requestId: request.requestId,
        }),
      },
    };

    if (!response.headersSent) {
      response.status(mapped.status).json(body);
    }
  }
}
