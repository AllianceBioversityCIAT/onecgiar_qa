import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { errorBody, FIELD_ERRORS } from '../common/error-codes.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import { roleAssignments } from '../database/drizzle/schema/role-assignments.js';
import { roles } from '../database/drizzle/schema/roles.js';
import {
  userProgramExclusions,
  type UserProgramExclusion,
} from '../database/drizzle/schema/user-program-exclusions.js';
import { userPrograms } from '../database/drizzle/schema/user-programs.js';
import {
  users,
  type AuthSource,
  type InvitationState,
  type User,
} from '../database/drizzle/schema/users.js';

export const USERS_QUERY_STORE = Symbol('USERS_QUERY_STORE');

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export type UserStatusFilter = 'active' | 'inactive' | 'all';
export type UserPopulation = 'team' | 'guests' | 'all';

/** The raw query of GET /users (T-8 validates the HTTP shape; the repository re-checks the bounds). */
export interface UserListQuery {
  q?: string;
  role?: string;
  resultType?: string;
  programId?: number;
  status?: UserStatusFilter;
  population?: UserPopulation;
  hasExclusions?: boolean;
  cursor?: string;
  limit?: number;
}

export interface UserSummary {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  accountType: AuthSource;
  status: 'active' | 'inactive';
  lastSignInAt: Date | null;
  invitation: InvitationState;
  roles: Array<{ role: string; resultTypes?: 'all' | string[] }>;
  programs: 'all' | number[];
  exclusions: Array<{
    id: number;
    programId: number;
    origin: 'manual' | 'reporting';
    reason: string | null;
    since: Date;
  }>;
}

export interface ActorRef {
  id: number;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ExclusionHistoryItem {
  id: number;
  programId: number;
  origin: 'manual' | 'reporting';
  status: 'removed' | 'dismissed';
  reason: string | null;
  reportingRole: string | null;
  since: Date;
  createdBy: ActorRef | null;
  endedAt: Date | null;
  endedBy: ActorRef | null;
  endReason: string | null;
}

export interface UserDetail extends UserSummary {
  exclusionHistory: ExclusionHistoryItem[];
}

export interface UserListPage {
  items: UserSummary[];
  nextCursor: string | null;
}

/**
 * The cursor or the limit of a list request is unusable (FR-9). T-8 maps it to
 * 400 `VALIDATION_FAILED` on `field`; the constructor takes the catalog body
 * so no message of its own reaches the client.
 */
export class InvalidListQueryError extends BadRequestException {
  constructor(readonly field: 'cursor' | 'limit') {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: [{ field, code: 'INVALID', message: FIELD_ERRORS.INVALID() }],
    });
  }
}

export interface UserListCriteria {
  q?: string;
  role?: string;
  resultType?: string;
  programId?: number;
  status: UserStatusFilter;
  population: UserPopulation;
  hasExclusions?: boolean;
  after?: { nickname: string | null; id: number };
  /** Rows to fetch (page size + 1, to know whether another page exists). */
  take: number;
}
export interface GrantRow {
  userId: number;
  roleCode: string;
  resultTypeKey: string | null;
  programId: number | null;
}
export interface ScopeRow {
  userId: number;
  programId: number;
}

export interface UsersQueryStore {
  findPage(criteria: UserListCriteria): Promise<User[]>;
  findById(id: number): Promise<User | undefined>;
  findActiveGrants(userIds: number[]): Promise<GrantRow[]>;
  findScopes(userIds: number[]): Promise<ScopeRow[]>;
  findExclusions(
    userIds: number[],
    activeOnly: boolean,
  ): Promise<UserProgramExclusion[]>;
  findActors(ids: number[]): Promise<ActorRef[]>;
}

/** Nickname NULL sorts LAST (GUESTs and legacy rows after named users); ties break by id. */
interface CursorKey {
  nickname: string | null;
  id: number;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify({ n: key.nickname, i: key.id })).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): CursorKey {
  const invalid = () => new InvalidListQueryError('cursor');
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid();
  }
  const { n, i } = parsed as { n?: unknown; i?: unknown };
  if (
    !(n === null || typeof n === 'string') ||
    typeof i !== 'number' ||
    !Number.isInteger(i) ||
    i < 1
  ) {
    throw invalid();
  }
  return { nickname: n, id: i };
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new InvalidListQueryError('limit');
  }
  return limit;
}

function groupRoles(grants: GrantRow[]): UserSummary['roles'] {
  const byRole = new Map<
    string,
    { all: boolean; keys: Set<string>; scoped: boolean }
  >();
  for (const grant of grants) {
    const entry = byRole.get(grant.roleCode) ?? {
      all: false,
      keys: new Set<string>(),
      scoped: false,
    };
    if (grant.resultTypeKey !== null) {
      entry.scoped = true;
      if (grant.resultTypeKey === '*') entry.all = true;
      else entry.keys.add(grant.resultTypeKey);
    }
    byRole.set(grant.roleCode, entry);
  }
  return [...byRole.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([role, entry]) => {
      if (!entry.scoped) return { role };
      return {
        role,
        resultTypes: entry.all ? ('all' as const) : [...entry.keys].sort(),
      };
    });
}

function toSummary(
  row: User,
  grants: GrantRow[],
  scopes: ScopeRow[],
  active: UserProgramExclusion[],
): UserSummary {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    nickname: row.nickname,
    accountType: row.authSource,
    status: row.isActive ? 'active' : 'inactive',
    lastSignInAt: row.lastLoginAt,
    invitation: row.invitation,
    roles: groupRoles(grants),
    // No user_programs rows = every program, current and future (DD-4).
    programs:
      scopes.length === 0
        ? 'all'
        : scopes.map((s) => s.programId).sort((a, b) => a - b),
    exclusions: active.map((e) => ({
      id: e.id,
      programId: e.programId,
      origin: e.origin,
      reason: e.reason,
      since: e.createdAt,
    })),
  };
}

function by<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(row);
    map.set(key(row), list);
  }
  return map;
}

/**
 * Read model of the admin users list and detail (design 6, 7; FR-9, FR-10).
 * List = one page query plus one bounded batch load per child table for the
 * page's ids (no per-user queries). Paging is keyset over (nickname, id).
 */
@Injectable()
export class UsersQueryRepository {
  constructor(
    @Inject(USERS_QUERY_STORE) private readonly store: UsersQueryStore,
  ) {}

  async list(query: UserListQuery = {}): Promise<UserListPage> {
    const limit = pageSize(query.limit);
    const after =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const q = query.q?.trim();
    const rows = await this.store.findPage({
      q: q ? q : undefined,
      role: query.role,
      resultType: query.resultType,
      programId: query.programId,
      status: query.status ?? 'active',
      population: query.population ?? 'team',
      hasExclusions: query.hasExclusions,
      after,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    if (page.length === 0) return { items: [], nextCursor: null };
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ nickname: last.nickname, id: last.id })
        : null;

    const userIds = page.map((u) => u.id);
    const [grants, scopes, exclusions] = await Promise.all([
      this.store.findActiveGrants(userIds),
      this.store.findScopes(userIds),
      this.store.findExclusions(userIds, true),
    ]);
    const grantsBy = by(grants, (g) => g.userId);
    const scopesBy = by(scopes, (s) => s.userId);
    const exclusionsBy = by(exclusions, (e) => e.userId);
    return {
      items: page.map((u) =>
        toSummary(
          u,
          grantsBy.get(u.id) ?? [],
          scopesBy.get(u.id) ?? [],
          exclusionsBy.get(u.id) ?? [],
        ),
      ),
      nextCursor,
    };
  }

  /** `undefined` when the user does not exist; T-8 maps it to 404 `USERS_NOT_FOUND`. */
  async get(id: number): Promise<UserDetail | undefined> {
    const row = await this.store.findById(id);
    if (!row) return undefined;
    const [grants, scopes, all] = await Promise.all([
      this.store.findActiveGrants([id]),
      this.store.findScopes([id]),
      this.store.findExclusions([id], false),
    ]);
    const ordered = [...all].sort((a, b) => a.id - b.id);
    const ended = ordered.filter((e) => e.status !== 'active');
    const actorIds = [
      ...new Set(
        ended
          .flatMap((e) => [e.createdBy, e.endedBy])
          .filter((v) => v !== null),
      ),
    ];
    const actors = new Map(
      (actorIds.length > 0 ? await this.store.findActors(actorIds) : []).map(
        (a) => [a.id, a] as const,
      ),
    );
    const actor = (actorId: number | null) =>
      actorId === null ? null : (actors.get(actorId) ?? null);
    return {
      ...toSummary(
        row,
        grants,
        scopes,
        ordered.filter((e) => e.status === 'active'),
      ),
      exclusionHistory: ended.map((e) => ({
        id: e.id,
        programId: e.programId,
        origin: e.origin,
        status: e.status === 'dismissed' ? 'dismissed' : 'removed',
        reason: e.reason,
        reportingRole: e.reportingRole,
        since: e.createdAt,
        createdBy: actor(e.createdBy),
        endedAt: e.endedAt,
        endedBy: actor(e.endedBy),
        endReason: e.endReason,
      })),
    };
  }
}

/** `%`, `_` and `\` are LIKE metacharacters (MySQL's default escape is `\`). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

type QueryDb = Pick<DrizzleDB, 'select'>;

/** Drizzle adapter of `UsersQueryStore`: read-only. */
@Injectable()
export class DrizzleUsersQueryStore implements UsersQueryStore {
  constructor(@Inject(DRIZZLE) private readonly db: QueryDb) {}

  /** A team member has an active grant or was created by someone (`created_by` not null). */
  private team(): SQL {
    const grant = this.db
      .select({ one: sql`1` })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, users.id),
          eq(roleAssignments.isActive, true),
        ),
      );
    return or(exists(grant), isNotNull(users.createdBy)) as SQL;
  }

  async findPage(c: UserListCriteria): Promise<User[]> {
    const conditions: Array<SQL | undefined> = [];
    if (c.status !== 'all') {
      conditions.push(eq(users.isActive, c.status === 'active'));
    }
    if (c.population === 'team') conditions.push(this.team());
    if (c.population === 'guests') conditions.push(not(this.team()));
    if (c.q !== undefined) {
      const pattern = likePattern(c.q);
      conditions.push(
        or(
          like(users.email, pattern),
          like(users.nickname, pattern),
          like(users.firstName, pattern),
          like(users.lastName, pattern),
        ),
      );
    }
    if (c.role !== undefined || c.resultType !== undefined) {
      // Role and result type must hold on the SAME active grant; `*` matches any result type (DD-1).
      const grant = this.db
        .select({ one: sql`1` })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(
          and(
            eq(roleAssignments.userId, users.id),
            eq(roleAssignments.isActive, true),
            c.role === undefined ? undefined : eq(roles.code, c.role),
            c.resultType === undefined
              ? undefined
              : or(
                  eq(roleAssignments.resultTypeKey, c.resultType),
                  eq(roleAssignments.resultTypeKey, '*'),
                ),
          ),
        );
      conditions.push(exists(grant));
    }
    if (c.programId !== undefined) {
      // No user_programs rows = all programs (DD-4). Active exclusions do not remove the match.
      const anyRow = this.db
        .select({ one: sql`1` })
        .from(userPrograms)
        .where(eq(userPrograms.userId, users.id));
      const thatRow = this.db
        .select({ one: sql`1` })
        .from(userPrograms)
        .where(
          and(
            eq(userPrograms.userId, users.id),
            eq(userPrograms.programId, c.programId),
          ),
        );
      conditions.push(or(notExists(anyRow), exists(thatRow)));
    }
    if (c.hasExclusions !== undefined) {
      const active = this.db
        .select({ one: sql`1` })
        .from(userProgramExclusions)
        .where(
          and(
            eq(userProgramExclusions.userId, users.id),
            eq(userProgramExclusions.status, 'active'),
          ),
        );
      conditions.push(c.hasExclusions ? exists(active) : notExists(active));
    }
    if (c.after) {
      const { nickname, id } = c.after;
      conditions.push(
        nickname === null
          ? and(isNull(users.nickname), gt(users.id, id))
          : or(
              gt(users.nickname, nickname),
              and(eq(users.nickname, nickname), gt(users.id, id)),
              isNull(users.nickname),
            ),
      );
    }
    return this.db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(
        asc(sql`${users.nickname} is null`),
        asc(users.nickname),
        asc(users.id),
      )
      .limit(c.take);
  }

  async findById(id: number): Promise<User | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }

  async findActiveGrants(userIds: number[]): Promise<GrantRow[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({
        userId: roleAssignments.userId,
        roleCode: roles.code,
        resultTypeKey: roleAssignments.resultTypeKey,
        programId: roleAssignments.programId,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          inArray(roleAssignments.userId, userIds),
          eq(roleAssignments.isActive, true),
        ),
      );
  }

  async findScopes(userIds: number[]): Promise<ScopeRow[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({
        userId: userPrograms.userId,
        programId: userPrograms.programId,
      })
      .from(userPrograms)
      .where(inArray(userPrograms.userId, userIds));
  }

  async findExclusions(
    userIds: number[],
    activeOnly: boolean,
  ): Promise<UserProgramExclusion[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select()
      .from(userProgramExclusions)
      .where(
        and(
          inArray(userProgramExclusions.userId, userIds),
          activeOnly ? eq(userProgramExclusions.status, 'active') : undefined,
        ),
      )
      .orderBy(asc(userProgramExclusions.id));
  }

  async findActors(ids: number[]): Promise<ActorRef[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: users.id,
        nickname: users.nickname,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(inArray(users.id, ids));
  }
}
