import type { RoleScopeType } from '../database/drizzle/schema/roles.js';

/**
 * Closed catalog of permissions, grouped by the role that owns them (design
 * section 7.1). Later specs add members here and to `ROLE_DEFINITIONS`; they
 * never add ad-hoc role checks.
 *
 * Only one auth-related permission per group exists for now. `READ` is not an
 * action permission: it is the marker every authenticated user holds (GUEST
 * included), consumed by the route guard for `@ReadAccess()` routes.
 */
export const Permission = {
  READ: 'READ',
  ADMIN_ACCESS: 'ADMIN_ACCESS',
  TPB_ACCESS: 'TPB_ACCESS',
  PPU_ACCESS: 'PPU_ACCESS',
  ASSESSOR_ACCESS: 'ASSESSOR_ACCESS',
  LEAD_ACCESS: 'LEAD_ACCESS',
  PROGRAM_ACCESS: 'PROGRAM_ACCESS',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const RoleCode = {
  ADMIN: 'ADMIN',
  LEAD_ASSESSOR: 'LEAD_ASSESSOR',
  ASSESSOR: 'ASSESSOR',
  TPB: 'TPB',
  PPU: 'PPU',
  PROGRAM: 'PROGRAM',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

export interface RoleDefinition {
  readonly code: RoleCode;
  readonly name: string;
  readonly scopeType: RoleScopeType;
  /**
   * Permissions the role grants, always within the assignment's own scope
   * (everywhere for `global`, the assigned result type for `result_type`,
   * the assigned program for `program`). LEAD_ASSESSOR lists the assessor
   * permission explicitly, so the expansion shares the lead's scope key.
   */
  readonly grants: readonly Permission[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    code: RoleCode.ADMIN,
    name: 'Administrator',
    scopeType: 'global',
    // FR-14, DD-10: every permission of the catalog, derived so a permission
    // added later is granted to ADMIN without touching this list.
    grants: Object.values(Permission),
  },
  {
    code: RoleCode.LEAD_ASSESSOR,
    name: 'Lead assessor',
    scopeType: 'result_type',
    grants: [Permission.LEAD_ACCESS, Permission.ASSESSOR_ACCESS],
  },
  {
    code: RoleCode.ASSESSOR,
    name: 'Assessor',
    scopeType: 'result_type',
    grants: [Permission.ASSESSOR_ACCESS],
  },
  {
    code: RoleCode.TPB,
    name: 'TPB',
    scopeType: 'global',
    grants: [Permission.TPB_ACCESS],
  },
  {
    code: RoleCode.PPU,
    name: 'PPU',
    scopeType: 'global',
    grants: [Permission.PPU_ACCESS],
  },
  {
    code: RoleCode.PROGRAM,
    name: 'Program',
    scopeType: 'program',
    grants: [Permission.PROGRAM_ACCESS],
  },
];

export function findRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((role) => role.code === code);
}

/**
 * Roles an admin may grant (FR-2, D6): every role but PROGRAM, which user
 * management does not grant (its future belongs to the comments spec). The
 * role catalog and the admin validators read this single list.
 */
export const GRANTABLE_ROLES: readonly RoleDefinition[] =
  ROLE_DEFINITIONS.filter((role) => role.code !== RoleCode.PROGRAM);

export function isGrantableRole(code: string): boolean {
  return GRANTABLE_ROLES.some((role) => role.code === code);
}
