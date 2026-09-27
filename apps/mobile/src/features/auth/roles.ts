import { Role, type UserProfile } from '@fieldops/types';

/**
 * What the signed-in user's role and organization mean for the app's screens. UX only: the
 * server enforces every rule again, so hiding a screen here is a convenience, never the
 * protection.
 */

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  WORKER: 'Worker',
  MANAGER: 'Manager',
  ORGANIZATION_ADMIN: 'Organization admin',
  SUPER_ADMIN: 'Platform admin',
};

type Who = Pick<UserProfile, 'role' | 'organization'> | null | undefined;

/** Runs the organization's operations: creates, assigns, verifies. */
export function isStaff(user: Who): boolean {
  return (
    user?.organization != null &&
    (user.role === Role.MANAGER || user.role === Role.ORGANIZATION_ADMIN)
  );
}

export function isOrganizationAdmin(user: Who): boolean {
  return user?.organization != null && user.role === Role.ORGANIZATION_ADMIN;
}

export function isSuperAdmin(user: Who): boolean {
  return user?.role === Role.SUPER_ADMIN;
}

/** A field worker with an organization (the offline working set applies). */
export function isFieldWorker(user: Who): boolean {
  return user?.organization != null && user.role === Role.WORKER;
}

/** A self-registered account no organization has added yet: nothing to work on. */
export function isUnaffiliated(user: Who): boolean {
  return (
    user != null && user.organization === null && user.role !== Role.SUPER_ADMIN
  );
}

/** The currency every amount of the user's organization is in. */
export function currencyOf(user: Who): string {
  return user?.organization?.currency ?? 'INR';
}
