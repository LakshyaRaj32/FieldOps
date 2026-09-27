import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AuthErrors } from '../errors/app-exception.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/** Injects the authenticated principal. Only valid on routes protected by the JWT guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.user === undefined) {
      // A route using @CurrentUser() must not be @Public(); fail closed if it is.
      throw AuthErrors.unauthenticated();
    }
    return request.user;
  },
);
