import { Injectable } from '@nestjs/common';
import {
  findRoleDefinition,
  Permission,
  type RoleDefinition,
} from './permissions.js';

/**
 * One assignment as the evaluator sees it: the stored scope plus the state
 * flags of the assignment and of its role. The repository produces these.
 */
export interface AssignmentView {
  roleCode: string;
  roleIsActive: boolean;
  isActive: boolean;
  revokedAt: Date | null;
  resultTypeKey: string | null;
  programId: number | null;
}

export interface AuthorizationSubject {
  assignments: readonly AssignmentView[];
}

export interface PermissionContext {
  resultType?: string | null;
  programId?: number | null;
}

/**
 * Permission evaluation (FR-3, design section 7.1): a pure function over the
 * user's assignments. Anything that is not an explicit match is a denial.
 */
@Injectable()
export class AuthorizationService {
  /**
   * Resource-scoped check, called once the resource is loaded (DD-4). A
   * result-type or program permission needs the matching context; without it
   * the answer is false (fail closed).
   */
  can(
    user: AuthorizationSubject,
    permission: Permission,
    ctx: PermissionContext = {},
  ): boolean {
    if (permission === Permission.READ) return true;
    return user.assignments.some((assignment) => {
      const role = grantingRole(assignment, permission);
      return role !== undefined && scopeMatches(role, assignment, ctx);
    });
  }

  /**
   * Route-level check: true when any live assignment grants the permission in
   * some scope. The resource scope is checked later with `can()`.
   */
  canAny(user: AuthorizationSubject, permission: Permission): boolean {
    if (permission === Permission.READ) return true;
    return user.assignments.some(
      (assignment) => grantingRole(assignment, permission) !== undefined,
    );
  }
}

/** The role definition when the assignment is live and its role grants `permission`. */
function grantingRole(
  assignment: AssignmentView,
  permission: Permission,
): RoleDefinition | undefined {
  if (!assignment.isActive || assignment.revokedAt !== null) return undefined;
  if (!assignment.roleIsActive) return undefined;
  const role = findRoleDefinition(assignment.roleCode);
  return role?.grants.includes(permission) ? role : undefined;
}

function scopeMatches(
  role: RoleDefinition,
  assignment: AssignmentView,
  ctx: PermissionContext,
): boolean {
  switch (role.scopeType) {
    case 'global':
      return true;
    case 'result_type':
      return (
        !!assignment.resultTypeKey &&
        ctx.resultType === assignment.resultTypeKey
      );
    case 'program':
      return (
        assignment.programId !== null && ctx.programId === assignment.programId
      );
  }
}
