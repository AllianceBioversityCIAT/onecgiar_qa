import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  roleAssignments,
  type NewRoleAssignment,
  type RoleAssignment,
} from '../database/drizzle/schema/role-assignments.js';
import { roles, type Role } from '../database/drizzle/schema/roles.js';
import type { AssignmentView } from './authorization.service.js';
import {
  AssignmentNotFoundError,
  DuplicateActiveAssignmentError,
  isDuplicateKeyError,
  ScopeMismatchError,
  UnknownRoleError,
} from './users.errors.js';

export const ROLE_ASSIGNMENTS_STORE = Symbol('ROLE_ASSIGNMENTS_STORE');

/**
 * `forShare` makes the read a locking read in share mode (DD-10): the user's
 * active assignment rows `FOR SHARE`, then their roles `FOR SHARE` by primary
 * key, in that order. It returns the latest committed version of those rows,
 * where a plain read inside the transaction keeps serving its snapshot, and
 * holds shared locks until the transaction ends: other readers do not wait, a
 * revoke or a role deactivation does.
 */
export interface AssignmentReadOptions {
  forShare?: boolean;
}

/** The persistence port of `RoleAssignmentsRepository` (TRD section 4, Repository). */
export interface RoleAssignmentsStore {
  findRoleByCode(code: string): Promise<Role | undefined>;
  /** `duplicate` = the user already holds this active assignment (DD-7). */
  insert(
    values: NewRoleAssignment,
  ): Promise<
    { kind: 'created'; assignment: RoleAssignment } | { kind: 'duplicate' }
  >;
  /** True when an active assignment was revoked; false when none matched. */
  revoke(id: number, revokedBy: number, at: Date): Promise<boolean>;
  findActiveViewsByUserId(
    userId: number,
    options?: AssignmentReadOptions,
  ): Promise<AssignmentView[]>;
}

export interface CreateAssignmentInput {
  userId: number;
  roleCode: string;
  resultTypeKey?: string | null;
  programId?: number | null;
  createdBy?: number | null;
}

const RESULT_TYPE_KEY_MAX_LENGTH = 64;
const UNSIGNED_INT_MAX = 4294967295;

/**
 * The only writer of `role_assignments` (design DD-8). Scope integrity — the
 * scope matches the role's `scope_type` — cannot be a MySQL CHECK, so it is
 * validated here before anything is stored.
 */
@Injectable()
export class RoleAssignmentsRepository {
  constructor(
    @Inject(ROLE_ASSIGNMENTS_STORE)
    private readonly store: RoleAssignmentsStore,
  ) {}

  async create(input: CreateAssignmentInput): Promise<RoleAssignment> {
    const role = await this.store.findRoleByCode(input.roleCode);
    if (!role) throw new UnknownRoleError(input.roleCode);

    const scope = validateScope(
      role,
      input.resultTypeKey ?? null,
      input.programId ?? null,
    );
    const result = await this.store.insert({
      userId: input.userId,
      roleId: role.id,
      ...scope,
      createdBy: input.createdBy ?? null,
    });
    if (result.kind === 'duplicate') throw new DuplicateActiveAssignmentError();
    return result.assignment;
  }

  /** Deactivates the assignment, keeping the row and its history. */
  async revoke(id: number, revokedBy: number): Promise<void> {
    const revoked = await this.store.revoke(id, revokedBy, new Date());
    if (!revoked) throw new AssignmentNotFoundError(id);
  }

  findActiveViewsByUserId(
    userId: number,
    options?: AssignmentReadOptions,
  ): Promise<AssignmentView[]> {
    return this.store.findActiveViewsByUserId(userId, options);
  }
}

function validateScope(
  role: Role,
  resultTypeKey: string | null,
  programId: number | null,
): { resultTypeKey: string | null; programId: number | null } {
  switch (role.scopeType) {
    case 'global':
      if (resultTypeKey !== null || programId !== null) {
        throw new ScopeMismatchError(
          `${role.code} is global and takes no scope value`,
        );
      }
      return { resultTypeKey: null, programId: null };
    case 'result_type':
      if (programId !== null) {
        throw new ScopeMismatchError(
          `${role.code} is scoped by result type, not by program`,
        );
      }
      // '' is rejected, not coerced: it would share an `active_key` with NULL.
      if (
        resultTypeKey === null ||
        resultTypeKey.length === 0 ||
        resultTypeKey !== resultTypeKey.trim() ||
        resultTypeKey.length > RESULT_TYPE_KEY_MAX_LENGTH
      ) {
        throw new ScopeMismatchError(
          `${role.code} needs a non-empty result type key (at most ${RESULT_TYPE_KEY_MAX_LENGTH} characters, no surrounding whitespace)`,
        );
      }
      return { resultTypeKey, programId: null };
    case 'program':
      if (resultTypeKey !== null) {
        throw new ScopeMismatchError(
          `${role.code} is scoped by program, not by result type`,
        );
      }
      if (
        programId === null ||
        !Number.isInteger(programId) ||
        programId < 1 ||
        programId > UNSIGNED_INT_MAX
      ) {
        throw new ScopeMismatchError(
          `${role.code} needs a positive integer program id`,
        );
      }
      return { resultTypeKey: null, programId };
  }
}

type AssignmentsDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;

/** Drizzle adapter of `RoleAssignmentsStore`. */
@Injectable()
export class DrizzleRoleAssignmentsStore implements RoleAssignmentsStore {
  constructor(@Inject(DRIZZLE) private readonly db: AssignmentsDb) {}

  async findRoleByCode(code: string) {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.code, code))
      .limit(1);
    return row;
  }

  async insert(values: NewRoleAssignment) {
    try {
      const [header] = await this.db.insert(roleAssignments).values(values);
      const [assignment] = await this.db
        .select()
        .from(roleAssignments)
        .where(eq(roleAssignments.id, header.insertId))
        .limit(1);
      if (!assignment) {
        throw new Error('Inserted assignment could not be read back');
      }
      return { kind: 'created' as const, assignment };
    } catch (error) {
      if (isDuplicateKeyError(error)) return { kind: 'duplicate' as const };
      throw error;
    }
  }

  async revoke(id: number, revokedBy: number, at: Date) {
    const [header] = await this.db
      .update(roleAssignments)
      .set({ isActive: false, revokedAt: at, revokedBy })
      .where(
        and(eq(roleAssignments.id, id), eq(roleAssignments.isActive, true)),
      );
    return header.affectedRows > 0;
  }

  async findActiveViewsByUserId(
    userId: number,
    options: AssignmentReadOptions = {},
  ): Promise<AssignmentView[]> {
    if (options.forShare) return this.lockActiveViewsByUserId(userId);
    const rows = await this.db
      .select({
        roleCode: roles.code,
        roleIsActive: roles.isActive,
        isActive: roleAssignments.isActive,
        revokedAt: roleAssignments.revokedAt,
        resultTypeKey: roleAssignments.resultTypeKey,
        programId: roleAssignments.programId,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.isActive, true),
        ),
      );
    return rows;
  }

  /**
   * The same views, read with shared locks: this user's active assignment rows
   * `FOR SHARE`, then their roles `FOR SHARE` by primary key (existing rows, so
   * record locks only). Two statements, not a join, so the lock order is
   * always `role_assignments` → `roles`, whatever plan a join would get.
   */
  private async lockActiveViewsByUserId(
    userId: number,
  ): Promise<AssignmentView[]> {
    const held = await this.db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.isActive, true),
        ),
      )
      .for('share');
    if (held.length === 0) return [];
    const roleRows = await this.db
      .select()
      .from(roles)
      .where(inArray(roles.id, [...new Set(held.map((a) => a.roleId))]))
      .for('share');
    const roleById = new Map(roleRows.map((role) => [role.id, role]));
    return held.flatMap((assignment) => {
      const role = roleById.get(assignment.roleId);
      return role
        ? [
            {
              roleCode: role.code,
              roleIsActive: role.isActive,
              isActive: assignment.isActive,
              revokedAt: assignment.revokedAt,
              resultTypeKey: assignment.resultTypeKey,
              programId: assignment.programId,
            },
          ]
        : [];
    });
  }
}
