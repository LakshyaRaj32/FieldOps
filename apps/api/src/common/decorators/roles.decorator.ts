import { SetMetadata } from '@nestjs/common';

import type { Role } from '../../users/role.js';

export const ROLES_KEY = 'fieldops:roles';

/**
 * Restricts a route (or controller) to users holding one of the given roles. Checked by
 * RolesGuard after authentication. This is the coarse role gate only; resource-level
 * policies ("is this worker assigned to this job?") arrive with the resources (V4+).
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
