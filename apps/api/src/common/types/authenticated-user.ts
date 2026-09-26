import type { Role } from '../../users/role.js';

/**
 * The principal attached to `request.user` by the JWT guard. Built from the verified token
 * and the current database state (session and user), so the role is never stale.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
}
