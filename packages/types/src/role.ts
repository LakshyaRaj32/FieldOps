/**
 * The roles a FieldOps user can hold within an organization.
 *
 * This is only the shared vocabulary. Deciding what each role may do is the
 * backend's job (introduced in Version 2). The role model is described in
 * docs/architecture.md, under "Role model".
 */
export const Role = {
  /** Field worker: carries out assigned jobs, often offline. */
  WORKER: 'WORKER',
  /** Assigns and monitors jobs and workers within their organization. */
  MANAGER: 'MANAGER',
  /** Administers the organization: users, roles, configuration, audit access. */
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof Role)[keyof typeof Role];
