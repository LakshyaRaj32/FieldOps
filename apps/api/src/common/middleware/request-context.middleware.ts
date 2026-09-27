import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept client IDs (the mobile app sends one) only when they are short and log-safe. */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

const logger = new Logger('HTTP');

/**
 * Assigns a correlation ID to every request, echoes it in the response header and writes one
 * access-log line when the response finishes.
 *
 * The log line contains method, path (without the query string), status, duration and
 * request ID. Headers and bodies are never logged: they carry tokens and passwords.
 * Structured logging and tracing replace this in V15.
 */
export function requestContext(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const clientId = request.header(REQUEST_ID_HEADER);
  const requestId =
    clientId !== undefined && CLIENT_REQUEST_ID.test(clientId)
      ? clientId
      : randomUUID();
  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = process.hrtime.bigint();
  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.log(
      `${request.method} ${request.path} ${response.statusCode} ${durationMs.toFixed(1)}ms requestId=${requestId}`,
    );
  });

  next();
}
