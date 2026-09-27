/**
 * The roles a FieldOps user can hold. One platform, four scopes (docs/business-domain.md,
 * "Roles and scopes"):
 *
 *   SUPER_ADMIN          the FieldOps platform: organizations and their administrators
 *   ORGANIZATION_ADMIN   one organization: its people, shops, products, orders and settings
 *   MANAGER              one organization, limited to their team and shops unless granted
 *                        organization-wide access
 *   WORKER               one organization, limited to the operations assigned to them
 *
 * This is only the shared vocabulary. Deciding what each role may do is the backend's job;
 * the app hides what the server would refuse, the server refuses it anyway.
 */
export const Role = {
  /** Field worker: carries out assigned operations, often offline. */
  WORKER: 'WORKER',
  /** Assigns and monitors operations for their team and shops. */
  MANAGER: 'MANAGER',
  /** Administers one organization: people, teams, shops, products, orders, settings. */
  ORGANIZATION_ADMIN: 'ORGANIZATION_ADMIN',
  /** Operates the FieldOps platform: creates, suspends and configures organizations. */
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Roles that belong to an organization (every role except the platform's). */
export const ORGANIZATION_ROLES = [
  Role.WORKER,
  Role.MANAGER,
  Role.ORGANIZATION_ADMIN,
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
