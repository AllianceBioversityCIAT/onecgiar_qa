import type { RoleAssignment } from '../../src/database/drizzle/schema/role-assignments.js';
import type { Role } from '../../src/database/drizzle/schema/roles.js';
import type { UserProgramExclusion } from '../../src/database/drizzle/schema/user-program-exclusions.js';
import type { UserProgram } from '../../src/database/drizzle/schema/user-programs.js';
import type { User } from '../../src/database/drizzle/schema/users.js';
import type {
  ActorRef,
  GrantRow,
  ScopeRow,
  UserListCriteria,
  UsersQueryStore,
} from '../../src/users/users-query.repository.js';
import type { InMemoryDatabase } from './in-memory-stores.js';

/**
 * `UsersQueryStore` over the committed rows of `InMemoryDatabase`, with the
 * semantics of the Drizzle adapter (team = a live grant or `created_by`; `*`
 * matches any result type; no scope row = every program; NULL nickname sorts
 * last). Only what the e2e suites exercise has to be exact, but none of it
 * is looser than the SQL.
 */
export class InMemoryUsersQueryStore implements UsersQueryStore {
  constructor(private readonly db: InMemoryDatabase) {}

  private roleOf(assignment: RoleAssignment): Role | undefined {
    return this.db.roles.find((role) => role.id === assignment.roleId);
  }

  private liveGrants(userId: number): Array<[RoleAssignment, Role]> {
    return this.db.assignments
      .filter((a) => a.userId === userId && a.isActive && a.revokedAt === null)
      .flatMap((a): Array<[RoleAssignment, Role]> => {
        const role = this.roleOf(a);
        return role?.isActive ? [[a, role]] : [];
      });
  }

  private isTeam(user: User): boolean {
    return this.liveGrants(user.id).length > 0 || user.createdBy !== null;
  }

  async findPage(c: UserListCriteria): Promise<User[]> {
    const q = c.q?.toLowerCase();
    const matches = this.db.users.filter((user) => {
      if (c.status !== 'all' && user.isActive !== (c.status === 'active')) {
        return false;
      }
      if (c.population === 'team' && !this.isTeam(user)) return false;
      if (c.population === 'guests' && this.isTeam(user)) return false;
      if (
        q !== undefined &&
        ![user.email, user.nickname, user.firstName, user.lastName].some(
          (value) => value?.toLowerCase().includes(q),
        )
      ) {
        return false;
      }
      if (c.role !== undefined || c.resultType !== undefined) {
        const hit = this.liveGrants(user.id).some(
          ([a, role]) =>
            (c.role === undefined || role.code === c.role) &&
            (c.resultType === undefined ||
              a.resultTypeKey === c.resultType ||
              a.resultTypeKey === '*'),
        );
        if (!hit) return false;
      }
      if (c.programId !== undefined) {
        const rows = this.db.scope.filter((s) => s.userId === user.id);
        if (rows.length > 0 && !rows.some((s) => s.programId === c.programId)) {
          return false;
        }
      }
      if (c.hasExclusions !== undefined) {
        const any = this.db.exclusions.some(
          (e) => e.userId === user.id && e.status === 'active',
        );
        if (any !== c.hasExclusions) return false;
      }
      return true;
    });
    const sorted = [...matches].sort((a, b) => {
      if ((a.nickname === null) !== (b.nickname === null)) {
        return a.nickname === null ? 1 : -1;
      }
      if (a.nickname !== b.nickname && a.nickname !== null) {
        return a.nickname! < b.nickname! ? -1 : 1;
      }
      return a.id - b.id;
    });
    const after = c.after;
    const rest =
      after === undefined
        ? sorted
        : sorted.filter((u) =>
            after.nickname === null
              ? u.nickname === null && u.id > after.id
              : u.nickname === null ||
                u.nickname > after.nickname ||
                (u.nickname === after.nickname && u.id > after.id),
          );
    return rest.slice(0, c.take);
  }

  async findById(id: number): Promise<User | undefined> {
    return this.db.users.find((user) => user.id === id);
  }

  async findActiveGrants(userIds: number[]): Promise<GrantRow[]> {
    return userIds.flatMap((userId) =>
      this.liveGrants(userId).map(([a, role]) => ({
        userId,
        roleCode: role.code,
        resultTypeKey: a.resultTypeKey,
        programId: a.programId,
      })),
    );
  }

  async findScopes(userIds: number[]): Promise<ScopeRow[]> {
    return this.db.scope
      .filter((s: UserProgram) => userIds.includes(s.userId))
      .map((s) => ({ userId: s.userId, programId: s.programId }));
  }

  async findExclusions(
    userIds: number[],
    activeOnly: boolean,
  ): Promise<UserProgramExclusion[]> {
    return this.db.exclusions
      .filter(
        (e) =>
          userIds.includes(e.userId) && (!activeOnly || e.status === 'active'),
      )
      .sort((a, b) => a.id - b.id);
  }

  async findActors(ids: number[]): Promise<ActorRef[]> {
    return this.db.users
      .filter((u) => ids.includes(u.id))
      .map((u) => ({
        id: u.id,
        nickname: u.nickname,
        firstName: u.firstName,
        lastName: u.lastName,
      }));
  }
}
