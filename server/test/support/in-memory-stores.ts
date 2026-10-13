import type {
  Role,
  RoleAssignment,
  User,
} from '../../src/database/drizzle/schema/index.js';
import type { NewRoleAssignment } from '../../src/database/drizzle/schema/role-assignments.js';
import type { NewUser } from '../../src/database/drizzle/schema/users.js';
import type { AssignmentView } from '../../src/users/authorization.service.js';
import type { RoleAssignmentsStore } from '../../src/users/role-assignments.repository.js';
import type {
  UserPatch,
  UsersStore,
} from '../../src/users/users.repository.js';

// Fake DB ports. They emulate what the database guarantees (unique keys, the
// generated `active_key`) so repository and seed behavior can be exercised
// without MySQL. `writes` counts every mutation, for "changes nothing" checks.

export class InMemoryUsersStore implements UsersStore {
  writes = 0;

  /** Pass another store's `rows` to model two transactions over one table. */
  constructor(readonly rows: User[] = []) {}

  async findById(id: number) {
    return this.rows.find((u) => u.id === id);
  }

  async findByEmail(email: string) {
    return this.rows.find((u) => u.email === email);
  }

  async findByCognitoSub(sub: string) {
    return this.rows.find((u) => u.cognitoSub === sub);
  }

  async insert(values: NewUser) {
    const clash = this.rows.some(
      (u) =>
        u.email === values.email ||
        (values.cognitoSub != null && u.cognitoSub === values.cognitoSub) ||
        // MySQL treats two '' values as equal under the unique index.
        (values.cognitoSub === '' && u.cognitoSub === ''),
    );
    if (clash) return { kind: 'duplicate' as const };
    this.writes++;
    const user: User = {
      id: this.rows.length + 1,
      cognitoSub: values.cognitoSub ?? null,
      cognitoUsername: values.cognitoUsername ?? null,
      email: values.email,
      firstName: values.firstName ?? null,
      lastName: values.lastName ?? null,
      authSource: values.authSource ?? 'sso',
      isActive: values.isActive ?? true,
      lastLoginAt: values.lastLoginAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: values.createdBy ?? null,
    };
    this.rows.push(user);
    return { kind: 'created' as const, user };
  }

  async update(id: number, values: UserPatch) {
    const row = this.rows.find((u) => u.id === id);
    if (!row) throw new Error(`No user ${id}`);
    const clash = this.rows.some(
      (u) =>
        u.id !== id &&
        ((values.email !== undefined && u.email === values.email) ||
          (values.cognitoSub != null && u.cognitoSub === values.cognitoSub)),
    );
    if (clash) return { kind: 'duplicate' as const };
    this.writes++;
    Object.assign(row, values, { updatedAt: new Date() });
    return { kind: 'updated' as const };
  }

  /** `UPDATE users SET cognito_sub = ? WHERE id = ? AND cognito_sub IS NULL`, on the current row. */
  async linkCognitoSub(id: number, sub: string) {
    const row = this.rows.find((u) => u.id === id);
    if (!row || row.cognitoSub !== null) {
      return { kind: 'already-linked' as const };
    }
    if (this.rows.some((u) => u.id !== id && u.cognitoSub === sub)) {
      return { kind: 'duplicate' as const };
    }
    this.writes++;
    Object.assign(row, { cognitoSub: sub, updatedAt: new Date() });
    return { kind: 'linked' as const };
  }
}

export class InMemoryRoleAssignmentsStore implements RoleAssignmentsStore {
  readonly roles: Role[] = [];
  readonly rows: RoleAssignment[] = [];
  writes = 0;

  addRole(role: Omit<Role, 'id'> & { id?: number }): Role {
    const row: Role = { ...role, id: role.id ?? this.roles.length + 1 };
    this.roles.push(row);
    return row;
  }

  async findRoleByCode(code: string): Promise<Role | undefined> {
    return this.roles.find((r) => r.code === code);
  }

  async insert(values: NewRoleAssignment) {
    // Emulates the stored generated `active_key` + its unique index.
    const key = (
      a: Pick<
        NewRoleAssignment,
        'userId' | 'roleId' | 'resultTypeKey' | 'programId'
      >,
    ) =>
      [a.userId, a.roleId, a.resultTypeKey ?? '', a.programId ?? ''].join(':');
    if (this.rows.some((a) => a.isActive && key(a) === key(values))) {
      return { kind: 'duplicate' as const };
    }
    this.writes++;
    const assignment: RoleAssignment = {
      id: this.rows.length + 1,
      userId: values.userId,
      roleId: values.roleId,
      resultTypeKey: values.resultTypeKey ?? null,
      programId: values.programId ?? null,
      isActive: true,
      createdAt: new Date(),
      createdBy: values.createdBy ?? null,
      revokedAt: null,
      revokedBy: null,
      activeKey: null,
    };
    this.rows.push(assignment);
    return { kind: 'created' as const, assignment };
  }

  async revoke(id: number, revokedBy: number, at: Date) {
    const row = this.rows.find((a) => a.id === id && a.isActive);
    if (!row) return false;
    this.writes++;
    row.isActive = false;
    row.revokedAt = at;
    row.revokedBy = revokedBy;
    return true;
  }

  async findActiveViewsByUserId(userId: number): Promise<AssignmentView[]> {
    return this.viewsOf(this.rows, userId);
  }

  /** The active assignments of a user among `rows`, with their `roles`; a snapshot fake may pass its own of either in place of the current ones. */
  protected viewsOf(
    rows: readonly RoleAssignment[],
    userId: number,
    roles: readonly Role[] = this.roles,
  ): AssignmentView[] {
    return rows
      .filter((a) => a.userId === userId && a.isActive)
      .map((a) => {
        const role = roles.find((r) => r.id === a.roleId)!;
        return {
          roleCode: role.code,
          roleIsActive: role.isActive,
          isActive: a.isActive,
          revokedAt: a.revokedAt,
          resultTypeKey: a.resultTypeKey,
          programId: a.programId,
        };
      });
  }
}
