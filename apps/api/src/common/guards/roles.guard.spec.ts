import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Role } from '../../users/role.js';
import { Roles } from '../decorators/roles.decorator.js';
import { AppException } from '../errors/app-exception.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { RolesGuard } from './roles.guard.js';

class ExampleController {
  @Roles(Role.MANAGER, Role.ORGANIZATION_ADMIN)
  managersOnly(): void {}

  anyAuthenticatedUser(): void {}
}

function contextFor(
  handler: keyof ExampleController,
  user: AuthenticatedUser | undefined,
): ExecutionContext {
  return {
    getHandler: () => ExampleController.prototype[handler],
    getClass: () => ExampleController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const userWith = (role: Role): AuthenticatedUser => ({
  userId: 'user-1',
  sessionId: 'session-1',
  role,
  organizationId: 'org-1',
  organizationWideAccess: false,
});

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof AppException ? error.code : 'NOT_AN_APP_EXCEPTION';
  }
  return undefined;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows any authenticated user on routes without @Roles', () => {
    expect(
      guard.canActivate(
        contextFor('anyAuthenticatedUser', userWith(Role.WORKER)),
      ),
    ).toBe(true);
  });

  it.each([Role.MANAGER, Role.ORGANIZATION_ADMIN])(
    'allows %s on a MANAGER/ADMIN route',
    role => {
      expect(
        guard.canActivate(contextFor('managersOnly', userWith(role))),
      ).toBe(true);
    },
  );

  it('forbids a WORKER on a MANAGER/ADMIN route (403 FORBIDDEN)', () => {
    const context = contextFor('managersOnly', userWith(Role.WORKER));
    expect(codeOf(() => guard.canActivate(context))).toBe('FORBIDDEN');
  });

  it('rejects a missing principal as unauthenticated (401), not forbidden', () => {
    const context = contextFor('managersOnly', undefined);
    expect(codeOf(() => guard.canActivate(context))).toBe('UNAUTHENTICATED');
  });
});
