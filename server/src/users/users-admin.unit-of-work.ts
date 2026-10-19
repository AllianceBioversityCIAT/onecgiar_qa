import { Inject, Injectable } from '@nestjs/common';
import { and, countDistinct, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { roleAssignments } from '../database/drizzle/schema/role-assignments.js';
import { roles, type Role } from '../database/drizzle/schema/roles.js';
import type { User } from '../database/drizzle/schema/users.js';
import { users } from '../database/drizzle/schema/users.js';
import { ROLE_DEFINITIONS, RoleCode } from './permissions.js';
import {
  DrizzleRoleAssignmentsStore,
  RoleAssignmentsRepository,
} from './role-assignments.repository.js';
import {
  DrizzleUserAuditStore,
  UserAuditRepository,
} from './user-audit.repository.js';
import {
  DrizzleUserProgramsStore,
  UserProgramsRepository,
} from './user-programs.repository.js';
import { LastAdminError, UserNotFoundError } from './users.errors.js';
import { DrizzleUsersStore, UsersRepository } from './users.repository.js';

export const USERS_ADMIN_UNIT_OF_WORK = Symbol('USERS_ADMIN_UNIT_OF_WORK');

/** The persistence port of `AdminGuard` (design 7, step 2). */
export interface AdminsStore {
  /** `SELECT ... FROM roles WHERE code = 'ADMIN' FOR UPDATE`; undefined when the role row does not exist. */
  lockAdminRole(): Promise<Role | undefined>;
  /**
   * Distinct active users holding an active grant of the active ADMIN role,
   * without `excludingUserId` when given. A plain read: fresh because the
   * unit of work runs READ COMMITTED (see `DrizzleUsersAdminUnitOfWork`).
   */
  countActiveAdmins(excludingUserId?: number): Promise<number>;
}

/**
 * The last-admin rule (FR-7, DD-3). Two admins that demote each other at the
 * same time would each count the other as the remaining admin and leave none,
 * so every admin-reducing change first takes the ADMIN `roles` row `FOR
 * UPDATE`: such changes serialize, and the one that waits counts after the
 * first has committed.
 */
export class AdminGuard {
  constructor(readonly store: AdminsStore) {}

  /**
   * Design 7, step 2: for a change that can reduce the active admins (revoke
   * ADMIN, deactivate an ADMIN), lock the ADMIN `roles` row, then count the
   * active admins other than `userId`; none left = `USERS_LAST_ADMIN`. The
   * count is read after the lock, from what is committed now: the unit of work
   * runs READ COMMITTED for exactly this.
   */
  async assertAnotherAdminRemains(userId: number): Promise<void> {
    await this.store.lockAdminRole();
    const remaining = await this.store.countActiveAdmins(userId);
    if (remaining === 0) throw new LastAdminError();
  }
}

/** The repositories of one admin transaction (design 4, 7). */
export interface UsersAdminRepositories {
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
  programs: UserProgramsRepository;
  audit: UserAuditRepository;
  admins: AdminGuard;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface UsersAdminUnitOfWork {
  run<T>(
    work: (repositories: UsersAdminRepositories) => Promise<T>,
  ): Promise<T>;
}

/** Design 7, step 1: the target user row `FOR UPDATE`; 404 when it does not exist. */
export async function lockTargetUser(
  { users: usersRepository }: Pick<UsersAdminRepositories, 'users'>,
  userId: number,
): Promise<User> {
  const user = await usersRepository.findById(userId, { forUpdate: true });
  if (!user) throw new UserNotFoundError(userId);
  return user;
}

type AdminsDb = Pick<DrizzleDB, 'select'>;

/** Drizzle adapter of `AdminsStore`. */
@Injectable()
export class DrizzleAdminsStore implements AdminsStore {
  constructor(@Inject(DRIZZLE) private readonly db: AdminsDb) {}

  async lockAdminRole() {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.code, RoleCode.ADMIN))
      .limit(1)
      .for('update');
    return role;
  }

  async countActiveAdmins(excludingUserId?: number) {
    const [row] = await this.db
      .select({ admins: countDistinct(users.id) })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(
        and(
          eq(roles.code, RoleCode.ADMIN),
          eq(roles.isActive, true),
          eq(roleAssignments.isActive, true),
          isNull(roleAssignments.revokedAt),
          inArray(
            roles.code,
            ROLE_DEFINITIONS.map((role) => role.code),
          ),
          eq(users.isActive, true),
          excludingUserId === undefined
            ? undefined
            : ne(users.id, excludingUserId),
        ),
      );
    return row?.admins ?? 0;
  }
}

/**
 * One MySQL transaction for an admin change, whose repositories are the ones
 * the rest of the app uses, bound to it (design 7).
 */
@Injectable()
export class DrizzleUsersAdminUnitOfWork implements UsersAdminUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  run<T>(
    work: (repositories: UsersAdminRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      (tx) =>
        work({
          users: new UsersRepository(new DrizzleUsersStore(tx)),
          assignments: new RoleAssignmentsRepository(
            new DrizzleRoleAssignmentsStore(tx),
          ),
          programs: new UserProgramsRepository(
            new DrizzleUserProgramsStore(tx),
          ),
          audit: new UserAuditRepository(new DrizzleUserAuditStore(tx)),
          admins: new AdminGuard(new DrizzleAdminsStore(tx)),
        }),
      // READ COMMITTED: a plain read sees what is committed when the statement
      // starts, so the admin count taken after the ADMIN roles row lock cannot
      // be a snapshot from before another admin's commit (DD-3). The other
      // decisions use locking reads, which are current at any level (DD-10).
      { isolationLevel: 'read committed' },
    );
  }
}
