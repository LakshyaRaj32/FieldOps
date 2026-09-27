import {
  createParamDecorator,
  HttpStatus,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../errors/app-exception.js';
import { ErrorCode } from '../errors/error-codes.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The optional `Idempotency-Key` request header: a UUID the client generates once per command
 * and repeats on every retry of it. Undefined when absent; a malformed key is a
 * VALIDATION_ERROR rather than being ignored, so a client bug cannot silently disable
 * deduplication.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const value = context
      .switchToHttp()
      .getRequest<Request>()
      .header(IDEMPOTENCY_KEY_HEADER);
    if (value === undefined) {
      return undefined;
    }
    if (!UUID.test(value)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Some fields are missing or invalid.',
        [
          {
            field: IDEMPOTENCY_KEY_HEADER,
            message: 'Idempotency-Key must be a UUID.',
          },
        ],
      );
    }
    return value.toLowerCase();
  },
);
