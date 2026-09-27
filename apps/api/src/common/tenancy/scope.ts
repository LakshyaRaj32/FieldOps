import { HttpStatus } from '@nestjs/common';

import { AppException } from '../errors/app-exception.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { Role } from '../../users/role.js';

/**
 * Tenant isolation, step one: every business request runs inside exactly one organization,
 * and that organization is the caller's own, taken from the verified principal (database
 * state), never from the request. Services start every business operation with orgScope(),
 * then filter every query by `organizationId` and check each loaded row against it
 * (docs/business-domain.md, "Tenant isolation").
 *
 * Step two, inside the organization: a MANAGER without organization-wide access reaches only
 * their team, the shops they cover and the operations they are responsible for (the
 * queries for that live in AccessService).
 */
export interface OrgScope {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Role;
  /**
   * Sees the whole organization: ORGANIZATION_ADMINs always, MANAGERs only when granted.
   * Workers never (they see what is assigned to them).
   */
  readonly organizationWide: boolean;
}

export const TenancyErrors = {
  notInOrganization: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.NOT_IN_ORGANIZATION,
      "Your account isn't part of an organization yet. Ask your administrator to add you.",
    ),
  organizationSuspended: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.ORGANIZATION_SUSPENDED,
      "Your organization's access to FieldOps is suspended.",
    ),
} as const;

/** Whether the user sees every team, shop and operation of their organization. */
export function isOrganizationWide(user: AuthenticatedUser): boolean {
  return (
    user.role === Role.ORGANIZATION_ADMIN ||
    (user.role === Role.MANAGER && user.organizationWideAccess)
  );
}

/**
 * The caller's organization scope. Refuses callers outside every organization: platform
 * SUPER_ADMINs (who manage organizations, not their operations) and unaffiliated accounts.
 */
export function orgScope(user: AuthenticatedUser): OrgScope {
  if (user.organizationId === null) {
    throw TenancyErrors.notInOrganization();
  }
  return {
    organizationId: user.organizationId,
    userId: user.userId,
    role: user.role,
    organizationWide: isOrganizationWide(user),
  };
}

/** Roles that run the organization's operations (create, assign, verify). */
export const STAFF_ROLES: readonly Role[] = [
  Role.MANAGER,
  Role.ORGANIZATION_ADMIN,
];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
