import { Inject, Injectable } from '@nestjs/common';
import type { AuthSource, User } from '../database/drizzle/schema/users.js';
import type {
  AssignmentView,
  AuthorizationSubject,
} from './authorization.service.js';
import { findRoleDefinition } from './permissions.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UsersRepository } from './users.repository.js';

/** Time source of the cache (epoch milliseconds); tests move it by hand. */
export const CURRENT_USER_CLOCK = Symbol('CURRENT_USER_CLOCK');

/** Freshness bound of FR-11: a change shows up within this many ms. */
export const CURRENT_USER_TTL_MS = 60_000;

/**
 * The user as a request sees it: the stored profile plus the active
 * assignments, frozen because one instance is shared by every request that
 * hits the cache.
 */
export interface AuthenticatedUser extends AuthorizationSubject {
  readonly id: number;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly authSource: AuthSource;
  readonly isActive: boolean;
  readonly assignments: readonly AssignmentView[];
}

/**
 * An assignment that can grant something: active, not revoked, and of a role
 * that is active and known to the permission catalog. Anything else is as good
 * as absent (fail closed).
 */
export function isLiveAssignment(assignment: AssignmentView): boolean {
  return (
    assignment.isActive &&
    assignment.revokedAt === null &&
    assignment.roleIsActive &&
    findRoleDefinition(assignment.roleCode) !== undefined
  );
}

/**
 * FR-11: who may use the API on each request. An inactive user is refused; an
 * SSO user is admitted with or without assignments (GUEST); a custom user
 * needs at least one live assignment.
 */
export function isAdmitted(user: AuthenticatedUser): boolean {
  if (!user.isActive) return false;
  return (
    user.authSource === 'sso' ||
    (user.authSource === 'custom' && user.assignments.some(isLiveAssignment))
  );
}

/** Builds the frozen request view of a stored user and its active assignments. */
export function toAuthenticatedUser(
  row: User,
  views: readonly AssignmentView[],
): AuthenticatedUser {
  return Object.freeze({
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    authSource: row.authSource,
    isActive: row.isActive,
    assignments: Object.freeze(views.map((view) => Object.freeze({ ...view }))),
  });
}

interface CacheEntry {
  readonly user: AuthenticatedUser;
  readonly expiresAt: number;
}

/**
 * Per-process cache of the current user, keyed by Cognito `sub` (design 7.1,
 * DD-6). A loaded user is served for at most `CURRENT_USER_TTL_MS`; writers
 * running in this process call `invalidate(userId)` after their commit to make
 * the change visible at once. Other processes catch up within the TTL.
 *
 * Only users that exist are cached; a `sub` without a QA user is looked up
 * again on every request. Entries are bounded by the number of QA users.
 */
@Injectable()
export class CurrentUserCache {
  private readonly entries = new Map<string, CacheEntry>();
  /** Bumped by every `invalidate`, so a load racing one never stores stale data. */
  private epoch = 0;

  constructor(
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(RoleAssignmentsRepository)
    private readonly assignments: RoleAssignmentsRepository,
    @Inject(CURRENT_USER_CLOCK) private readonly now: () => number,
  ) {}

  /** The user with this `sub`, or `undefined` when QA has none. Admission is the caller's rule (`isAdmitted`). */
  async getBySub(sub: string): Promise<AuthenticatedUser | undefined> {
    const now = this.now();
    const cached = this.entries.get(sub);
    if (cached) {
      if (now < cached.expiresAt) return cached.user;
      this.entries.delete(sub);
    }

    const epoch = this.epoch;
    const row = await this.users.findByCognitoSub(sub);
    if (!row) return undefined;
    const views = await this.assignments.findActiveViewsByUserId(row.id);

    const user = toAuthenticatedUser(row, views);
    // The bound counts from before the reads, so the data is never older than it.
    if (epoch === this.epoch) {
      this.entries.set(sub, {
        user,
        expiresAt: now + CURRENT_USER_TTL_MS,
      });
    }
    return user;
  }

  /** Drops the cached state of a user; call it after the change is committed. */
  invalidate(userId: number): void {
    this.epoch++;
    for (const [sub, entry] of this.entries) {
      if (entry.user.id === userId) this.entries.delete(sub);
    }
  }
}
