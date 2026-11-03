import { RoleName } from '../auth/auth.models';

/**
 * Mirror of the server catalog `server/src/users/permissions.ts` (ROLE_DEFINITIONS) and of
 * `server/src/users/authorization.service.ts` (can / canAny). The server stays the authority:
 * this copy only decides what the UI shows and which routes it opens. Keep both in sync;
 * `role-definitions.spec.ts` pins the current values.
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

export type RoleScopeType = 'global' | 'result_type' | 'program';

export interface RoleDefinition {
  readonly code: RoleName;
  readonly name: string;
  readonly scopeType: RoleScopeType;
  /** Granted only within the assignment's own scope. ADMIN does NOT imply the other permissions. */
  readonly grants: readonly Permission[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  { code: 'ADMIN', name: 'Administrator', scopeType: 'global', grants: [Permission.ADMIN_ACCESS] },
  {
    code: 'LEAD_ASSESSOR',
    name: 'Lead assessor',
    scopeType: 'result_type',
    grants: [Permission.LEAD_ACCESS, Permission.ASSESSOR_ACCESS],
  },
  {
    code: 'ASSESSOR',
    name: 'Assessor',
    scopeType: 'result_type',
    grants: [Permission.ASSESSOR_ACCESS],
  },
  { code: 'TPB', name: 'TPB', scopeType: 'global', grants: [Permission.TPB_ACCESS] },
  { code: 'PPU', name: 'PPU', scopeType: 'global', grants: [Permission.PPU_ACCESS] },
  { code: 'PROGRAM', name: 'Program', scopeType: 'program', grants: [Permission.PROGRAM_ACCESS] },
];

export function findRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((role) => role.code === code);
}

/** Resource the permission is checked against (same names as the server `PermissionContext`). */
export interface PermissionContext {
  readonly resultType?: string | null;
  readonly programId?: number | null;
}
