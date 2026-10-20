import { IdempotencyFenceLostError } from '../../src/common/idempotency/idempotency.errors.js';
import type {
  IdempotencyClock,
  IdempotencyRow,
  IdempotencyStore,
  Reservation,
} from '../../src/common/idempotency/idempotency.store.js';
import type {
  Role,
  RoleAssignment,
  User,
  UserAuditEvent,
  UserProgram,
  UserProgramExclusion,
} from '../../src/database/drizzle/schema/index.js';
import type { NewRoleAssignment } from '../../src/database/drizzle/schema/role-assignments.js';
import type { NewUserAuditEvent } from '../../src/database/drizzle/schema/user-audit-events.js';
import type { NewUserProgramExclusion } from '../../src/database/drizzle/schema/user-program-exclusions.js';
import type { NewUser } from '../../src/database/drizzle/schema/users.js';
import type { AssignmentView } from '../../src/users/authorization.service.js';
import { RoleCode } from '../../src/users/permissions.js';
import {
  RoleAssignmentsRepository,
  type ActiveAssignment,
  type AssignmentReadOptions,
  type RoleAssignmentsStore,
} from '../../src/users/role-assignments.repository.js';
import {
  UserAuditRepository,
  type UserAuditStore,
} from '../../src/users/user-audit.repository.js';
import {
  UserProgramsRepository,
  type ExclusionEnd,
  type ProgramReadOptions,
  type UserProgramsStore,
} from '../../src/users/user-programs.repository.js';
import {
  AdminGuard,
  type AdminsStore,
  type UsersAdminRepositories,
  type UsersAdminUnitOfWork,
} from '../../src/users/users-admin.unit-of-work.js';
import {
  idempotencyLockKey,
  InMemoryIdempotencyStore,
} from './in-memory-idempotency.js';
import {
  UsersRepository,
  type ReadOptions,
  type UserPatch,
  type UsersStore,
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

  /** Case-insensitive, like the column's collation (P-7). */
  async findByNickname(nickname: string) {
    return this.rows.find(
      (u) => u.nickname?.toLowerCase() === nickname.toLowerCase(),
    );
  }

  async insert(values: NewUser) {
    const clash = this.rows.some(
      (u) =>
        u.email === values.email ||
        (values.nickname != null &&
          u.nickname?.toLowerCase() === values.nickname.toLowerCase()) ||
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
      nickname: values.nickname ?? null,
      invitation: values.invitation ?? 'none',
      invitedAt: values.invitedAt ?? null,
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
          (values.nickname != null &&
            u.nickname?.toLowerCase() === values.nickname.toLowerCase()) ||
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
  writes = 0;

  /** Pass arrays shared with other stores to model one table (or a transaction's view of it). */
  constructor(
    readonly rows: RoleAssignment[] = [],
    readonly roles: Role[] = [],
  ) {}

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

  async findActiveByUserId(userId: number): Promise<ActiveAssignment[]> {
    return this.withIds(this.rows, userId);
  }

  protected withIds(
    rows: readonly RoleAssignment[],
    userId: number,
  ): ActiveAssignment[] {
    const active = rows.filter((a) => a.userId === userId && a.isActive);
    const views = this.viewsOf(active, userId);
    return active.map((a, i) => ({ id: a.id, ...views[i]! }));
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

// ---------------------------------------------------------------------------
// User management: program scope, exclusions, audit, last-admin count (T-4)
// ---------------------------------------------------------------------------

type LockMode = 'S' | 'X';

/**
 * How a statement runs. The plain stores ignore it; the transactional ones
 * (below) take the locks first, then read the latest committed rows when
 * `current` is set (a locking read, a conditional write) or, under REPEATABLE
 * READ, serve a plain read from the transaction's snapshot.
 */
export interface StatementOptions {
  current?: boolean;
  locks?: ReadonlyArray<readonly [key: string, mode: LockMode]>;
}

function checkFailed(name: string): never {
  throw Object.assign(new Error(`Check constraint '${name}' is violated.`), {
    code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    errno: 3819,
  });
}

/** The CHECKs of `user_program_exclusions` (schema file, DD-12) on the row as it would be stored. */
export function assertExclusionChecks(row: UserProgramExclusion): void {
  const filled = (value: string | null) =>
    value !== null && value.trim() !== '';
  if (row.origin === 'manual' && !filled(row.reason)) {
    checkFailed('chk_user_program_exclusions_manual_reason');
  }
  if (
    row.status === 'dismissed' &&
    !(row.origin === 'reporting' && filled(row.endReason))
  ) {
    checkFailed('chk_user_program_exclusions_dismissed');
  }
  const consistent =
    row.status === 'active'
      ? row.endedAt === null && row.endedBy === null && row.endReason === null
      : row.endedAt !== null &&
        (row.endedBy !== null ||
          (row.origin === 'reporting' && row.status === 'removed'));
  if (!consistent) checkFailed('chk_user_program_exclusions_ended');
}

function nextId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

/**
 * `user_programs` and `user_program_exclusions`: the primary key of the scope,
 * the unique `active_key` and the three CHECKs are emulated, so a repository
 * that breaks one of them fails here as it would on MySQL.
 */
export class InMemoryUserProgramsStore implements UserProgramsStore {
  writes = 0;

  constructor(
    readonly scope: UserProgram[] = [],
    readonly exclusions: UserProgramExclusion[] = [],
  ) {}

  protected async statement<R>(
    _options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return run();
  }

  protected newExclusionId(): number {
    return nextId(this.exclusions);
  }

  findScope(userId: number, options?: ProgramReadOptions) {
    return this.statement({ current: options?.forUpdate }, () =>
      this.scope
        .filter((row) => row.userId === userId)
        .map((row) => row.programId)
        .sort((a, b) => a - b),
    );
  }

  addPrograms(userId: number, programIds: number[]) {
    return this.statement({ current: true }, () => {
      for (const programId of programIds) {
        if (
          this.scope.some(
            (row) => row.userId === userId && row.programId === programId,
          )
        ) {
          throw Object.assign(new Error('Duplicate entry'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          });
        }
        this.writes++;
        this.scope.push({ userId, programId });
      }
    });
  }

  removePrograms(userId: number, programIds: number[]) {
    return this.statement({ current: true }, () => {
      for (const programId of programIds) {
        const at = this.scope.findIndex(
          (row) => row.userId === userId && row.programId === programId,
        );
        if (at >= 0) {
          this.writes++;
          this.scope.splice(at, 1);
        }
      }
    });
  }

  findExclusions(userId: number, options?: ProgramReadOptions) {
    return this.statement({ current: options?.forUpdate }, () =>
      this.exclusions.filter((row) => row.userId === userId),
    );
  }

  findActiveExclusions(userId: number) {
    return this.statement({}, () =>
      this.exclusions.filter(
        (row) => row.userId === userId && row.status === 'active',
      ),
    );
  }

  findExclusionById(userId: number, id: number, options?: ProgramReadOptions) {
    return this.statement({ current: options?.forUpdate }, () =>
      this.exclusions.find((row) => row.id === id && row.userId === userId),
    );
  }

  insertExclusion(values: NewUserProgramExclusion) {
    return this.statement({ current: true }, () => {
      const status = values.status ?? 'active';
      const exclusion: UserProgramExclusion = {
        id: this.newExclusionId(),
        userId: values.userId,
        programId: values.programId,
        origin: values.origin,
        status,
        reason: values.reason ?? null,
        reportingRole: values.reportingRole ?? null,
        createdAt: (values.createdAt as Date | undefined) ?? new Date(),
        createdBy: values.createdBy ?? null,
        endedAt: (values.endedAt as Date | null | undefined) ?? null,
        endedBy: values.endedBy ?? null,
        endReason: values.endReason ?? null,
        activeKey:
          status === 'active' ? `${values.userId}:${values.programId}` : null,
      };
      assertExclusionChecks(exclusion);
      if (
        exclusion.activeKey !== null &&
        this.exclusions.some((row) => row.activeKey === exclusion.activeKey)
      ) {
        return { kind: 'duplicate' as const };
      }
      this.writes++;
      this.exclusions.push(exclusion);
      return { kind: 'created' as const, exclusion };
    });
  }

  endExclusion(id: number, end: ExclusionEnd) {
    return this.statement({ current: true }, () => {
      const row = this.exclusions.find(
        (exclusion) => exclusion.id === id && exclusion.status === 'active',
      );
      if (!row) return false;
      const ended: UserProgramExclusion = {
        ...row,
        status: end.status,
        endedBy: end.endedBy,
        endReason: end.endReason,
        endedAt: end.at,
        activeKey: null,
      };
      assertExclusionChecks(ended);
      this.writes++;
      Object.assign(row, ended);
      return true;
    });
  }
}

/** `user_audit_events`: insert and read, nothing else (append-only). */
export class InMemoryUserAuditStore implements UserAuditStore {
  writes = 0;

  constructor(readonly rows: UserAuditEvent[] = []) {}

  protected async statement<R>(
    _options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return run();
  }

  protected newEventId(): number {
    return nextId(this.rows);
  }

  insert(values: NewUserAuditEvent) {
    return this.statement({ current: true }, () => {
      const event: UserAuditEvent = {
        id: this.newEventId(),
        userId: values.userId,
        actorId: values.actorId,
        action: values.action,
        changes: structuredClone(values.changes),
        requestId: values.requestId ?? null,
        createdAt: (values.createdAt as Date | undefined) ?? new Date(),
      };
      this.writes++;
      this.rows.push(event);
      return event;
    });
  }

  findByUserId(userId: number, limit: number) {
    return this.statement({}, () =>
      this.rows
        .filter((row) => row.userId === userId)
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
        )
        .slice(0, limit),
    );
  }
}

/** Distinct active users holding an active grant of the active ADMIN role, `excluding` one. */
function countActiveAdmins(
  users: readonly User[],
  roles: readonly Role[],
  assignments: readonly RoleAssignment[],
  excluding?: number,
): number {
  const admin = roles.find((role) => role.code === RoleCode.ADMIN);
  if (!admin || !admin.isActive) return 0;
  const holders = new Set(
    assignments
      .filter((a) => a.roleId === admin.id && a.isActive)
      .map((a) => a.userId),
  );
  return users.filter(
    (user) => holders.has(user.id) && user.isActive && user.id !== excluding,
  ).length;
}

/** The last-admin count over plain rows (no transaction, no lock). */
export class InMemoryAdminsStore implements AdminsStore {
  constructor(
    private readonly users: readonly User[],
    private readonly assignments: InMemoryRoleAssignmentsStore,
  ) {}

  async lockAdminRole() {
    return this.assignments.roles.find((role) => role.code === RoleCode.ADMIN);
  }

  async countActiveAdmins(excludingUserId?: number) {
    return countActiveAdmins(
      this.users,
      this.assignments.roles,
      this.assignments.rows,
      excludingUserId,
    );
  }
}

// ---------------------------------------------------------------------------
// A transactional world: row locks, uncommitted writes, snapshot reads
// ---------------------------------------------------------------------------

/**
 * InnoDB's two isolation levels that matter here. A plain read under READ
 * COMMITTED sees what is committed when the statement starts; under REPEATABLE
 * READ it sees the snapshot of the transaction's first read (here: its begin).
 * A locking read and a conditional write see what is committed now, at either.
 */
export type IsolationLevel = 'read committed' | 'repeatable read';

/**
 * Row locks held until the owner commits or rolls back. An `X` lock waits for
 * every other owner; an `S` lock waits only for an `X`. Waiting is the only
 * thing it does: transactions are NOT serialized as a whole, so a flow that
 * forgets a lock races exactly as it would on MySQL.
 */
class RowLocks {
  private readonly held = new Map<
    string,
    { exclusive?: object; shared: Set<object> }
  >();
  private waiters: Array<() => void> = [];

  async acquire(owner: object, key: string, mode: LockMode): Promise<void> {
    for (;;) {
      const lock = this.held.get(key) ?? { shared: new Set<object>() };
      const blockedByExclusive =
        lock.exclusive !== undefined && lock.exclusive !== owner;
      const blockedByShared =
        mode === 'X' && [...lock.shared].some((other) => other !== owner);
      if (!blockedByExclusive && !blockedByShared) {
        if (mode === 'X') lock.exclusive = owner;
        else lock.shared.add(owner);
        this.held.set(key, lock);
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  releaseAll(owner: object): void {
    for (const [key, lock] of this.held) {
      if (lock.exclusive === owner) lock.exclusive = undefined;
      lock.shared.delete(owner);
      if (lock.exclusive === undefined && lock.shared.size === 0) {
        this.held.delete(key);
      }
    }
    const waiting = this.waiters;
    this.waiters = [];
    for (const wake of waiting) wake();
  }
}

/** One table as one transaction sees it: the visible rows, and what this transaction changed. */
class TransactionTable<T> {
  /** The rows the transaction's stores read and write, mutated in place. */
  readonly rows: T[];
  private readonly dirty = new Map<string, T | null>();
  private baseline = new Map<string, string>();

  constructor(
    private readonly committed: T[],
    private readonly keyOf: (row: T) => string,
  ) {
    this.rows = structuredClone(committed);
  }

  /** The committed rows now, overlaid with this transaction's own changes. */
  refresh(): void {
    const next: T[] = [];
    const seen = new Set<string>();
    for (const row of this.committed) {
      const key = this.keyOf(row);
      seen.add(key);
      const own = this.dirty.get(key);
      if (own === undefined) next.push(structuredClone(row));
      else if (own !== null) next.push(own);
    }
    for (const [key, own] of this.dirty) {
      if (!seen.has(key) && own !== null) next.push(own);
    }
    this.rows.length = 0;
    this.rows.push(...next);
  }

  /** Remembers the visible rows as the statement starts, so only its own changes are recorded. */
  mark(): void {
    this.baseline = new Map(
      this.rows.map((row) => [this.keyOf(row), JSON.stringify(row)]),
    );
  }

  /** Records what the statement changed in the visible rows since `mark()`. */
  capture(): void {
    const visible = new Set<string>();
    for (const row of this.rows) {
      const key = this.keyOf(row);
      visible.add(key);
      if (this.baseline.get(key) !== JSON.stringify(row)) {
        this.dirty.set(key, row);
      }
    }
    for (const key of this.baseline.keys()) {
      if (!visible.has(key)) this.dirty.set(key, null);
    }
  }

  commit(): void {
    for (const [key, row] of this.dirty) {
      const at = this.committed.findIndex((r) => this.keyOf(r) === key);
      if (row === null) {
        if (at >= 0) this.committed.splice(at, 1);
      } else if (at >= 0) {
        this.committed[at] = row;
      } else {
        this.committed.push(row);
      }
    }
  }
}

export class InMemoryTransaction {
  private readonly tables: TransactionTable<never>[] = [];
  private finished = false;

  constructor(
    readonly db: InMemoryDatabase,
    readonly isolation: IsolationLevel,
  ) {}

  table<T>(committed: T[], keyOf: (row: T) => string): TransactionTable<T> {
    const table = new TransactionTable(committed, keyOf);
    this.tables.push(table as unknown as TransactionTable<never>);
    return table;
  }

  lock(key: string, mode: LockMode): Promise<void> {
    return this.db.locks.acquire(this, key, mode);
  }

  /** Locks first (they may wait for another transaction), then the read view. */
  async statement<R>(
    options: StatementOptions & { tables: readonly unknown[][] },
    run: () => R | Promise<R>,
  ): Promise<R> {
    for (const [key, mode] of options.locks ?? []) await this.lock(key, mode);
    // READ COMMITTED: every statement reads what is committed now. REPEATABLE
    // READ: only a current read (a locking read, a conditional write) does,
    // and only for the tables it touches; a plain read keeps the snapshot.
    const refreshed =
      this.isolation === 'read committed'
        ? this.tables
        : options.current
          ? this.tables.filter((table) => options.tables.includes(table.rows))
          : [];
    for (const table of refreshed) table.refresh();
    for (const table of this.tables) table.mark();
    try {
      return await run();
    } finally {
      for (const table of this.tables) table.capture();
    }
  }

  commit(): void {
    if (this.finished) return;
    this.finished = true;
    for (const table of this.tables) table.commit();
    this.db.locks.releaseAll(this);
  }

  rollback(): void {
    if (this.finished) return;
    this.finished = true;
    this.db.locks.releaseAll(this);
  }

  /** The repositories of the unit of work, over this transaction's stores. */
  repositories(): UsersAdminRepositories {
    const { db } = this;
    const users = this.table(db.users, (row) => String(row.id));
    const roles = this.table(db.roles, (row) => String(row.id));
    const assignments = this.table(db.assignments, (row) => String(row.id));
    const scope = this.table(
      db.scope,
      (row) => `${row.userId}:${row.programId}`,
    );
    const exclusions = this.table(db.exclusions, (row) => String(row.id));
    const audit = this.table(db.audit, (row) => String(row.id));
    const idempotency = this.table(
      db.idempotency,
      (row) => `${row.actorId}\u0000${row.idemKey}`,
    );
    return {
      idempotency: new TransactionalIdempotencyStore(this, idempotency.rows),
      users: new UsersRepository(new TransactionalUsersStore(this, users.rows)),
      assignments: new RoleAssignmentsRepository(
        new TransactionalAssignmentsStore(this, assignments.rows, roles.rows),
      ),
      programs: new UserProgramsRepository(
        new TransactionalUserProgramsStore(this, scope.rows, exclusions.rows),
      ),
      audit: new UserAuditRepository(
        new TransactionalUserAuditStore(this, audit.rows),
      ),
      admins: new AdminGuard(
        new TransactionalAdminsStore(
          this,
          users.rows,
          roles.rows,
          assignments.rows,
        ),
      ),
    };
  }
}

class TransactionalUsersStore extends InMemoryUsersStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    rows: User[],
  ) {
    super(rows);
  }

  private statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return this.tx.statement({ ...options, tables: [this.rows] }, run);
  }

  private async locked(
    options: ReadOptions | undefined,
    read: () => Promise<User | undefined>,
  ): Promise<User | undefined> {
    const row = await this.statement({ current: options?.forUpdate }, read);
    if (!options?.forUpdate || !row) return row;
    // A locking read waits for the row, then reads it as committed after the wait.
    return this.statement(
      { current: true, locks: [[`users:${row.id}`, 'X']] },
      read,
    );
  }

  override findById(id: number, options?: ReadOptions) {
    return options?.forUpdate
      ? this.statement({ current: true, locks: [[`users:${id}`, 'X']] }, () =>
          super.findById(id),
        )
      : this.statement({}, () => super.findById(id));
  }

  override findByEmail(email: string, options?: ReadOptions) {
    return this.locked(options, () => super.findByEmail(email));
  }

  override findByCognitoSub(sub: string, options?: ReadOptions) {
    return this.locked(options, () => super.findByCognitoSub(sub));
  }

  override findByNickname(nickname: string, options?: ReadOptions) {
    return this.locked(options, () => super.findByNickname(nickname));
  }

  override insert(values: NewUser) {
    return this.statement({ current: true }, async () => {
      const result = await super.insert(values);
      if (result.kind === 'created') {
        result.user.id = this.tx.db.nextId('users');
      }
      return result;
    });
  }

  override update(id: number, values: UserPatch) {
    return this.statement({ current: true }, () => super.update(id, values));
  }

  override linkCognitoSub(id: number, sub: string) {
    return this.statement({ current: true }, () =>
      super.linkCognitoSub(id, sub),
    );
  }
}

class TransactionalAssignmentsStore extends InMemoryRoleAssignmentsStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    rows: RoleAssignment[],
    roles: Role[],
  ) {
    super(rows, roles);
  }

  private statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return this.tx.statement(
      { ...options, tables: [this.rows, this.roles] },
      run,
    );
  }

  override findRoleByCode(code: string) {
    return this.statement({}, () => super.findRoleByCode(code));
  }

  override findActiveByUserId(userId: number) {
    return this.statement({}, () => this.withIds(this.rows, userId));
  }

  override insert(values: NewRoleAssignment) {
    // The foreign key to `roles` takes a shared lock on the role row.
    return this.statement(
      { current: true, locks: [[`roles:${values.roleId}`, 'S']] },
      async () => {
        const result = await super.insert(values);
        if (result.kind === 'created') {
          result.assignment.id = this.tx.db.nextId('assignments');
        }
        return result;
      },
    );
  }

  override revoke(id: number, revokedBy: number, at: Date) {
    return this.statement(
      { current: true, locks: [[`assignments:${id}`, 'X']] },
      () => super.revoke(id, revokedBy, at),
    );
  }

  override async findActiveViewsByUserId(
    userId: number,
    options?: AssignmentReadOptions,
  ): Promise<AssignmentView[]> {
    if (!options?.forShare) {
      return this.statement({}, () => this.viewsOf(this.rows, userId));
    }
    // FOR SHARE on the user's active assignment rows, then on their roles.
    const held = await this.statement({ current: true }, () =>
      this.rows.filter((a) => a.userId === userId && a.isActive),
    );
    const locks: Array<readonly [string, LockMode]> = [
      ...held.map((a) => [`assignments:${a.id}`, 'S'] as const),
      ...[...new Set(held.map((a) => a.roleId))].map(
        (roleId) => [`roles:${roleId}`, 'S'] as const,
      ),
    ];
    return this.statement({ current: true, locks }, () =>
      this.viewsOf(this.rows, userId),
    );
  }
}

class TransactionalUserProgramsStore extends InMemoryUserProgramsStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    scope: UserProgram[],
    exclusions: UserProgramExclusion[],
  ) {
    super(scope, exclusions);
  }

  protected override statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return this.tx.statement(
      { ...options, tables: [this.scope, this.exclusions] },
      run,
    );
  }

  protected override newExclusionId(): number {
    return this.tx.db.nextId('exclusions');
  }
}

class TransactionalUserAuditStore extends InMemoryUserAuditStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    rows: UserAuditEvent[],
  ) {
    super(rows);
  }

  protected override statement<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return this.tx.statement({ ...options, tables: [this.rows] }, run);
  }

  protected override newEventId(): number {
    return this.tx.db.nextId('audit');
  }
}

class TransactionalAdminsStore implements AdminsStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    private readonly users: User[],
    private readonly roles: Role[],
    private readonly assignments: RoleAssignment[],
  ) {}

  async lockAdminRole() {
    const role = await this.tx.statement({ tables: [this.roles] }, () =>
      this.roles.find((r) => r.code === RoleCode.ADMIN),
    );
    if (!role) return undefined;
    // `SELECT ... FOR UPDATE` waits for the holder, then reads the row as committed after the wait.
    return this.tx.statement(
      {
        current: true,
        locks: [[`roles:${role.id}`, 'X']],
        tables: [this.roles],
      },
      () => this.roles.find((r) => r.code === RoleCode.ADMIN),
    );
  }

  countActiveAdmins(excludingUserId?: number) {
    return this.tx.statement({ tables: [] }, () =>
      countActiveAdmins(
        this.users,
        this.roles,
        this.assignments,
        excludingUserId,
      ),
    );
  }
}

/**
 * `markExecuted` bound to a transaction (what `new DrizzleIdempotencyStore(tx,
 * clock)` is in production): the UPDATE takes the row lock and keeps it until
 * the business transaction ends, sees the row as committed at that moment (a
 * take-over that committed earlier makes it match no row), and its effect is
 * visible to others only when the transaction commits; a rollback drops it
 * together with the change (T-2 review forward pointer).
 */
class TransactionalIdempotencyStore implements Pick<
  IdempotencyStore,
  'markExecuted'
> {
  constructor(
    private readonly tx: InMemoryTransaction,
    private readonly rows: IdempotencyRow[],
  ) {}

  async markExecuted(reservation: Reservation, targetUserId: number) {
    const changed = await this.tx.statement(
      {
        current: true,
        locks: [
          [idempotencyLockKey(reservation.actorId, reservation.key), 'X'],
        ],
        tables: [this.rows],
      },
      () => {
        const row = this.rows.find(
          (r) =>
            r.actorId === reservation.actorId && r.idemKey === reservation.key,
        );
        if (
          !row ||
          row.state !== 'in_progress' ||
          row.ownerToken !== reservation.ownerToken
        ) {
          return false;
        }
        row.state = 'executed';
        row.targetUserId = targetUserId;
        return true;
      },
    );
    if (!changed) throw new IdempotencyFenceLostError();
  }
}

/**
 * The tables of the user-management world as committed rows, plus the row
 * locks. `begin()` opens a transaction that sees its own uncommitted writes,
 * hides everyone else's until they commit, and waits on row locks: this is
 * the fake for races (two `run`s started together interleave at every
 * `await`). Seed and inspect through `stores`, which work on the committed
 * rows outside any transaction.
 */
export class InMemoryDatabase {
  readonly users: User[] = [];
  readonly roles: Role[] = [];
  readonly assignments: RoleAssignment[] = [];
  readonly scope: UserProgram[] = [];
  readonly exclusions: UserProgramExclusion[] = [];
  readonly audit: UserAuditEvent[] = [];
  /** Committed `idempotency_keys` rows, shared with the autocommit store of `idempotencyStore()`. */
  readonly idempotency: IdempotencyRow[] = [];
  readonly locks = new RowLocks();

  /** Plain stores over the committed rows. */
  readonly stores = {
    users: new InMemoryUsersStore(this.users),
    assignments: new InMemoryRoleAssignmentsStore(this.assignments, this.roles),
    programs: new InMemoryUserProgramsStore(this.scope, this.exclusions),
    audit: new InMemoryUserAuditStore(this.audit),
  };

  /** The interceptor's own store over this database: same rows, same row locks as the transactions. */
  idempotencyStore(
    clock: IdempotencyClock,
    newToken?: () => string,
  ): InMemoryIdempotencyStore {
    return new InMemoryIdempotencyStore(clock, newToken, {
      rows: this.idempotency,
      locks: this.locks,
    });
  }

  private readonly issued = new Map<string, number>();

  /** A fresh primary key, unique across transactions that insert at the same time. */
  nextId(table: 'users' | 'assignments' | 'exclusions' | 'audit'): number {
    const committed = this[table] as Array<{ id: number }>;
    const id = Math.max(this.issued.get(table) ?? 0, nextId(committed) - 1) + 1;
    this.issued.set(table, id);
    return id;
  }

  begin(isolation: IsolationLevel = 'read committed'): InMemoryTransaction {
    return new InMemoryTransaction(this, isolation);
  }
}

/**
 * `UsersAdminUnitOfWork` over `InMemoryDatabase`: commits when `work`
 * resolves, rolls back (writes dropped, locks released) when it throws.
 * READ COMMITTED by default, as the Drizzle unit of work pins it.
 */
export class InMemoryUsersAdminUnitOfWork implements UsersAdminUnitOfWork {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly isolation: IsolationLevel = 'read committed',
  ) {}

  async run<T>(
    work: (repositories: UsersAdminRepositories) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.begin(this.isolation);
    try {
      const result = await work(tx.repositories());
      tx.commit();
      return result;
    } catch (error) {
      tx.rollback();
      throw error;
    }
  }
}
