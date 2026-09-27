import type {
  OrganizationRole as SharedOrgRole,
  Role as SharedRole,
} from '@fieldops/types';

import { Role } from '../generated/prisma/enums.js';

/**
 * The Role enum used by the API is the one Prisma generates from the database schema.
 * It must stay identical to the shared vocabulary in @fieldops/types; this assignment fails
 * to compile if either side gains or loses a role.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const roleContract: Same<Role, SharedRole> = true;
void roleContract;

export const ORGANIZATION_ROLES = [
  Role.WORKER,
  Role.MANAGER,
  Role.ORGANIZATION_ADMIN,
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

const orgRoleContract: Same<OrganizationRole, SharedOrgRole> = true;
void orgRoleContract;

export { Role };
