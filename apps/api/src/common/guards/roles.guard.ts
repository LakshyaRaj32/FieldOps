import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { AuthErrors } from '../errors/app-exception.js';
import type { Role } from '../../users/role.js';

/**
 * Role-based authorization foundation. Runs after the JWT guard (both are global, in that
 * order). Routes without @Roles() only require authentication.
 *
 * 401 means "we don't know who you are"; 403 means "we know, and the answer is no".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles === undefined || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<Request>();
    if (user === undefined) {
      throw AuthErrors.unauthenticated();
    }
    if (!requiredRoles.includes(user.role)) {
      throw AuthErrors.forbidden();
    }
    return true;
  }
}
