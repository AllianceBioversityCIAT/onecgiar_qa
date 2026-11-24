import { Service, computed, inject } from '@angular/core';
import { AuthSession } from '../auth/auth-session';
import { Assignment } from '../auth/auth.models';
import {
  Permission,
  PermissionContext,
  RoleDefinition,
  findRoleDefinition,
} from './role-definitions';

/** Pure evaluation, same rules as the server (`authorization.service.ts`): anything not explicit is a denial. */
export function canAny(assignments: readonly Assignment[], permission: Permission): boolean {
  if (permission === Permission.READ) return true;
  return assignments.some((assignment) => grantingRole(assignment, permission) !== undefined);
}

export function can(
  assignments: readonly Assignment[],
  permission: Permission,
  ctx: PermissionContext = {},
): boolean {
  if (permission === Permission.READ) return true;
  return assignments.some((assignment) => {
    const role = grantingRole(assignment, permission);
    return role !== undefined && scopeMatches(role, assignment, ctx);
  });
}

function grantingRole(assignment: Assignment, permission: Permission): RoleDefinition | undefined {
  const role = findRoleDefinition(assignment.role);
  return role?.grants.includes(permission) ? role : undefined;
}

function scopeMatches(
  role: RoleDefinition,
  assignment: Assignment,
  ctx: PermissionContext,
): boolean {
  switch (role.scopeType) {
    case 'global':
      return true;
    case 'result_type':
      return !!assignment.resultTypeKey && ctx.resultType === assignment.resultTypeKey;
    case 'program':
      return assignment.programId != null && ctx.programId === assignment.programId;
  }
}

/**
 * The single place the UI asks "may this user…?". Components and routes never compare role
 * names or ids. Signal-based: every `computed` that calls it updates when the session changes.
 */
@Service()
export class AccessControl {
  private readonly session = inject(AuthSession);

  readonly assignments = computed<readonly Assignment[]>(
    () => this.session.user()?.assignments ?? [],
  );

  /** Every permission granted in some scope (route level, like the server `canAny`). */
  readonly permissions = computed<ReadonlySet<Permission>>(() => {
    const granted = new Set<Permission>([Permission.READ]);
    for (const p of Object.values(Permission)) {
      if (canAny(this.assignments(), p)) granted.add(p);
    }
    return granted;
  });

  readonly isAdmin = computed(() => this.permissions().has(Permission.ADMIN_ACCESS));
  /** Signed in with no live assignment: read only. */
  readonly isGuest = computed(() => this.session.isSignedIn() && this.assignments().length === 0);

  /** Route / menu level: the permission is granted in at least one scope. */
  canAny(permission: Permission): boolean {
    return this.permissions().has(permission);
  }

  /** Resource level: the scope of the loaded resource must match (fail closed without context). */
  can(permission: Permission, ctx: PermissionContext = {}): boolean {
    return can(this.assignments(), permission, ctx);
  }
}
