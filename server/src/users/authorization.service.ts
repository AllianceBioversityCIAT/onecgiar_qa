import { Injectable } from '@nestjs/common';
import {
  coversProgram,
  coversResultType,
  type ProgramScopeView,
} from './effective-scope.js';
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

export interface AuthorizationSubject extends Partial<ProgramScopeView> {
  assignments: readonly AssignmentView[];
}

/** What a review check is asked about: the result's type and its Science Program. */
export interface ReviewTarget {
  resultType: string;
  programId: number;
}

/**
 * Seam for the timeline rule (D9): later specs add visibility predicates here
 * as one more conjunct of `canReview`; none exists yet.
 */
export type ReviewPredicate = (
  user: AuthorizationSubject,
  target: ReviewTarget,
) => boolean;

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
   * Review check (D5, D9): the permission for the result's type (exact key or
   * `*`, via `can()`), **and** the program inside the effective program scope
   * (no rows = all, an active exclusion removes its program), **and** every
   * extra predicate (the timeline rule will be one). Fail closed.
   *
   * DD-13: a subject holding a live ADMIN grant is exempt from program scope
   * and exclusions only (D3 over FR-4); exclusions stay stored and apply again
   * once the grant is revoked. Extra predicates still apply to ADMIN: DD-13
   * does not exempt them.
   */
  canReview(
    user: AuthorizationSubject,
    permission: Permission,
    target: ReviewTarget,
    ...predicates: ReviewPredicate[]
  ): boolean {
    const exemptFromScope = this.can(user, Permission.ADMIN_ACCESS);
    return (
      this.can(user, permission, { resultType: target.resultType }) &&
      (exemptFromScope || coversProgram(user, target.programId)) &&
      predicates.every((holds) => holds(user, target))
    );
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
      return coversResultType(assignment.resultTypeKey, ctx.resultType);
    case 'program':
      return (
        assignment.programId !== null && ctx.programId === assignment.programId
      );
  }
}
