/**
 * Organizations (tenants), their members and teams. See docs/business-domain.md.
 */

import type { UserSummary } from './jobs';
import type { OrganizationRole, Role } from './role';

export const OrganizationStatus = {
  ACTIVE: 'ACTIVE',
  /** Members cannot sign in or use the API; data is kept untouched. */
  SUSPENDED: 'SUSPENDED',
} as const;

export type OrganizationStatus =
  (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/** What every member's app needs to know about their organization. */
export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  /** ISO 4217 code; every amount of the organization is in its minor unit. */
  readonly currency: string;
  /** IANA time zone: the organization's calendar day ("due today", "collected today"). */
  readonly timeZone: string;
}

export interface Organization extends OrganizationSummary {
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly address: string | null;
  /** How far from a shop a reported position may be before it is flagged (meters). */
  readonly arrivalRadiusMeters: number;
  /** Members, counted on the platform list (SUPER_ADMIN). */
  readonly memberCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A new account created by an administrator (it signs in with this initial password). */
export interface NewAccount {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  /** At least 12 characters; the person should change it after signing in. */
  readonly password: string;
}

/** POST /organizations (SUPER_ADMIN). */
export interface CreateOrganizationRequest {
  readonly name: string;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly address?: string;
  /** Defaults to INR. */
  readonly currency?: string;
  /** Defaults to Asia/Kolkata. */
  readonly timeZone?: string;
  /** Defaults to 300. */
  readonly arrivalRadiusMeters?: number;
  /** The first organization admin, created in the same transaction. */
  readonly admin?: NewAccount;
}

/** PATCH /organizations/:id (SUPER_ADMIN) and PATCH /organization (ORGANIZATION_ADMIN). */
export interface UpdateOrganizationRequest {
  readonly name?: string;
  readonly contactName?: string | null;
  readonly contactEmail?: string | null;
  readonly contactPhone?: string | null;
  readonly address?: string | null;
  readonly timeZone?: string;
  readonly arrivalRadiusMeters?: number;
}

/** A person in an organization, as its administrators see them. */
export interface Member {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
  readonly isActive: boolean;
  /** MANAGER: sees every team, shop and operation of the organization. */
  readonly organizationWideAccess: boolean;
  /** WORKER: the manager whose team they are in now (null: no team). */
  readonly manager: UserSummary | null;
  readonly createdAt: string;
}

/** POST /organization/members (ORGANIZATION_ADMIN). */
export interface CreateMemberRequest extends NewAccount {
  readonly role: OrganizationRole;
  /** WORKER: put them in this manager's team. */
  readonly managerId?: string;
  /** MANAGER: grant organization-wide access. */
  readonly organizationWideAccess?: boolean;
}

/** PATCH /organization/members/:id (ORGANIZATION_ADMIN). */
export interface UpdateMemberRequest {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly role?: OrganizationRole;
  /** false signs the person out everywhere and blocks sign-in. */
  readonly isActive?: boolean;
  readonly organizationWideAccess?: boolean;
}

/** PUT /organization/members/:id/manager: move a worker to a team (null: no team). */
export interface SetManagerRequest {
  readonly managerId: string | null;
}

/** POST /auth/change-password. Every other session of the user is signed out. */
export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}
