import type { Role } from '../../users/role.js';

/**
 * The principal attached to `request.user` by the JWT guard. Built from the verified token
 * and the current database state (session, user and organization), so the role, the
 * organization and its status are never stale. Nothing here comes from the client: this is
 * what every tenancy and permission check is decided against.
 */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
  /** Null for SUPER_ADMINs and for self-registered accounts no organization has added. */
  readonly organizationId: string | null;
  /** MANAGER only: sees every team, shop and operation of the organization. */
  readonly organizationWideAccess: boolean;
}
