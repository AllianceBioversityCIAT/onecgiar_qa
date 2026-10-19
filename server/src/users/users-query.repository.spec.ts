import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../database/drizzle/schema/index.js';
import type { UserProgramExclusion } from '../database/drizzle/schema/user-program-exclusions.js';
import type { User } from '../database/drizzle/schema/users.js';
import {
  DrizzleUsersQueryStore,
  UsersQueryRepository,
  type ActorRef,
  type GrantRow,
  type ScopeRow,
  type UserListCriteria,
  type UsersQueryStore,
} from './users-query.repository.js';
import { InvalidListQueryError } from './users.errors.js';

// Expected values come from FR-9 / FR-10 and design 6 and 7, written as literals:
// team = an active grant or created_by set; GUESTs only by filter; sort by
// nickname then id (NULL nicknames last, decision T-7); no row = all programs
// (DD-4); `*` = every result type (DD-1); ended_by NULL = system (DD-12).

let nextId = 100;
function user(over: Partial<User> & { id?: number } = {}): User {
  const id = over.id ?? nextId++;
  return {
    id,
    cognitoSub: null,
    cognitoUsername: null,
    email: `user${id}@example.org`,
    firstName: null,
    lastName: null,
    authSource: 'sso',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 1,
    nickname: null,
    invitation: 'none',
    invitedAt: null,
    ...over,
  };
}

function exclusion(over: Partial<UserProgramExclusion>): UserProgramExclusion {
  return {
    id: 1,
    userId: 1,
    programId: 1,
    origin: 'manual',
    status: 'active',
    reason: 'because',
    reportingRole: null,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: 1,
    endedAt: null,
    endedBy: null,
    endReason: null,
    activeKey: null,
    ...over,
  };
}

/**
 * An in-memory store with the semantics of the SQL (independently written):
 * filters, population, and keyset paging over (nickname NULLS LAST, id).
 */
class FakeStore implements UsersQueryStore {
  users: User[] = [];
  grants: Array<GrantRow & { roleActive?: boolean }> = [];
  /** Mirrors the SQL `liveGrant`: a grant of a deactivated role holds no permission. */
  private live() {
    return this.grants.filter((g) => g.roleActive !== false);
  }
  scopes: ScopeRow[] = [];
  exclusions: UserProgramExclusion[] = [];
  criteria: UserListCriteria[] = [];
  calls = { grants: 0, scopes: 0, exclusions: 0, actors: 0 };

  private isTeam(u: User) {
    return this.live().some((g) => g.userId === u.id) || u.createdBy !== null;
  }

  findPage(c: UserListCriteria): Promise<User[]> {
    this.criteria.push(c);
    const q = c.q?.toLowerCase();
    const rows = this.users
      .filter((u) =>
        c.status === 'all' ? true : u.isActive === (c.status === 'active'),
      )
      .filter((u) => {
        if (c.population === 'all') return true;
        return c.population === 'team' ? this.isTeam(u) : !this.isTeam(u);
      })
      .filter(
        (u) =>
          q === undefined ||
          [u.email, u.nickname, u.firstName, u.lastName].some((v) =>
            v?.toLowerCase().includes(q),
          ),
      )
      .filter((u) => {
        if (c.role === undefined && c.resultType === undefined) return true;
        return this.live().some(
          (g) =>
            g.userId === u.id &&
            (c.role === undefined || g.roleCode === c.role) &&
            (c.resultType === undefined ||
              g.resultTypeKey === '*' ||
              g.resultTypeKey === c.resultType),
        );
      })
      .filter((u) => {
        if (c.programId === undefined) return true;
        const own = this.scopes.filter((s) => s.userId === u.id);
        return own.length === 0 || own.some((s) => s.programId === c.programId);
      })
      .filter((u) => {
        if (c.hasExclusions === undefined) return true;
        const has = this.exclusions.some(
          (e) => e.userId === u.id && e.status === 'active',
        );
        return has === c.hasExclusions;
      })
      .sort((a, b) => {
        if ((a.nickname === null) !== (b.nickname === null))
          return a.nickname === null ? 1 : -1;
        if (
          a.nickname !== null &&
          b.nickname !== null &&
          a.nickname !== b.nickname
        ) {
          return a.nickname.localeCompare(b.nickname);
        }
        return a.id - b.id;
      });
    const after = c.after;
    const start = after
      ? rows.findIndex((u) =>
          after.nickname === null
            ? u.nickname === null && u.id > after.id
            : u.nickname === null ||
              u.nickname.localeCompare(after.nickname) > 0 ||
              (u.nickname === after.nickname && u.id > after.id),
        )
      : 0;
    return Promise.resolve(start < 0 ? [] : rows.slice(start, start + c.take));
  }
  findById(id: number) {
    return Promise.resolve(this.users.find((u) => u.id === id));
  }
  findActiveGrants(ids: number[]) {
    this.calls.grants++;
    return Promise.resolve(this.live().filter((g) => ids.includes(g.userId)));
  }
  findScopes(ids: number[]) {
    this.calls.scopes++;
    return Promise.resolve(this.scopes.filter((s) => ids.includes(s.userId)));
  }
  findExclusions(ids: number[], activeOnly: boolean) {
    this.calls.exclusions++;
    return Promise.resolve(
      this.exclusions.filter(
        (e) => ids.includes(e.userId) && (!activeOnly || e.status === 'active'),
      ),
    );
  }
  findActors(ids: number[]): Promise<ActorRef[]> {
    this.calls.actors++;
    return Promise.resolve(
      this.users
        .filter((u) => ids.includes(u.id))
        .map((u) => ({
          id: u.id,
          nickname: u.nickname,
          firstName: u.firstName,
          lastName: u.lastName,
        })),
    );
  }
}

function setup() {
  const store = new FakeStore();
  return { store, repo: new UsersQueryRepository(store) };
}

const ids = (page: { items: Array<{ id: number }> }) =>
  page.items.map((i) => i.id);

describe('UsersQueryRepository.list — search (FR-9)', () => {
  it('matches q over email, nickname, first name and last name, case-insensitively', async () => {
    const { store, repo } = setup();
    store.users = [
      user({ id: 1, email: 'zed@example.org', nickname: 'zed' }),
      user({ id: 2, email: 'ana@cgiar.org', nickname: 'ana' }),
      user({ id: 3, nickname: 'bob', firstName: 'Carmen' }),
      user({ id: 4, nickname: 'dan', lastName: 'Carmona' }),
    ];
    expect(ids(await repo.list({ q: 'CGIAR' }))).toEqual([2]);
    expect(ids(await repo.list({ q: 'zed' }))).toEqual([1]);
    expect(ids(await repo.list({ q: 'carm' }))).toEqual([3, 4]);
  });

  it('trims q and ignores a blank q', async () => {
    const { store, repo } = setup();
    store.users = [
      user({ id: 1, nickname: 'a' }),
      user({ id: 2, nickname: 'b' }),
    ];
    await repo.list({ q: '   ' });
    expect(store.criteria[0]?.q).toBeUndefined();
    await repo.list({ q: '  b ' });
    expect(store.criteria[1]?.q).toBe('b');
  });
});

describe('UsersQueryRepository.list — filters and population (FR-9)', () => {
  function world() {
    const { store, repo } = setup();
    store.users = [
      user({ id: 1, nickname: 'ana' }), // team: assessor KP
      user({ id: 2, nickname: 'ben' }), // team: assessor all types, programs 5,6
      user({ id: 3, nickname: 'cat', isActive: false }), // team: admin, inactive
      user({ id: 4, nickname: null, createdBy: null }), // guest
      user({ id: 5, nickname: 'eve', createdBy: 1 }), // team by created_by, no grants
    ];
    store.grants = [
      { userId: 1, roleCode: 'ASSESSOR', resultTypeKey: 'KP', programId: null },
      { userId: 2, roleCode: 'ASSESSOR', resultTypeKey: '*', programId: null },
      { userId: 3, roleCode: 'ADMIN', resultTypeKey: null, programId: null },
    ];
    store.scopes = [
      { userId: 2, programId: 5 },
      { userId: 2, programId: 6 },
    ];
    store.exclusions = [
      exclusion({ id: 1, userId: 1, programId: 5 }),
      exclusion({
        id: 2,
        userId: 2,
        programId: 9,
        status: 'removed',
        endedAt: new Date(),
        endedBy: 1,
      }),
    ];
    return { store, repo };
  }

  it('defaults to active team members: GUESTs and inactive users are left out', async () => {
    const { repo } = world();
    expect(ids(await repo.list())).toEqual([1, 2, 5]);
  });

  it('population=guests lists only users without a grant and without created_by', async () => {
    const { repo } = world();
    expect(
      ids(await repo.list({ population: 'guests', status: 'all' })),
    ).toEqual([4]);
  });

  it('population=all includes team and guests', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ population: 'all' }))).toEqual([1, 2, 5, 4]);
  });

  it('status filter: inactive and all', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ status: 'inactive' }))).toEqual([3]);
    expect(ids(await repo.list({ status: 'all' }))).toEqual([1, 2, 3, 5]);
  });

  it('role filter', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ role: 'ASSESSOR' }))).toEqual([1, 2]);
    expect(ids(await repo.list({ role: 'ADMIN', status: 'all' }))).toEqual([3]);
  });

  it('resultType filter: a user with * matches any result type', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ resultType: 'KP' }))).toEqual([1, 2]);
    expect(ids(await repo.list({ resultType: 'INNOVATION_DEV' }))).toEqual([2]);
  });

  it('programId filter: no user_programs rows = all programs (DD-4); an active exclusion does not remove the match', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ programId: 5 }))).toEqual([1, 2, 5]);
    expect(ids(await repo.list({ programId: 7 }))).toEqual([1, 5]);
  });

  it('hasExclusions counts active exclusions only', async () => {
    const { repo } = world();
    expect(ids(await repo.list({ hasExclusions: true }))).toEqual([1]);
    expect(ids(await repo.list({ hasExclusions: false }))).toEqual([2, 5]);
  });

  it('a grant of a deactivated role is no grant: not team, not matched by role, not in roles; still listed with population=all', async () => {
    const { store, repo } = setup();
    store.users = [user({ id: 20, nickname: 'dora', createdBy: null })];
    store.grants = [
      {
        userId: 20,
        roleCode: 'ASSESSOR',
        resultTypeKey: 'KP',
        programId: null,
        roleActive: false,
      },
    ];
    expect(ids(await repo.list())).toEqual([]);
    expect(
      ids(await repo.list({ role: 'ASSESSOR', population: 'all' })),
    ).toEqual([]);
    expect(
      ids(await repo.list({ resultType: 'KP', population: 'all' })),
    ).toEqual([]);
    expect(ids(await repo.list({ population: 'guests' }))).toEqual([20]);
    const all = await repo.list({ population: 'all' });
    expect(ids(all)).toEqual([20]);
    expect(all.items[0]?.roles).toEqual([]);
    expect((await repo.get(20))?.roles).toEqual([]);
  });

  it('combines filters with AND', async () => {
    const { repo } = world();
    expect(
      ids(
        await repo.list({ role: 'ASSESSOR', programId: 7, resultType: 'KP' }),
      ),
    ).toEqual([1]);
  });
});

describe('UsersQueryRepository.list — keyset paging (FR-9)', () => {
  function crowd(count: number) {
    const { store, repo } = setup();
    store.users = Array.from({ length: count }, (_, i) =>
      user({ id: i + 1, nickname: `n${String(i).padStart(2, '0')}` }),
    );
    return { store, repo };
  }

  it('walks every user exactly once, in nickname then id order, across pages', async () => {
    const { repo } = crowd(5);
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.list({ limit: 2, cursor });
      seen.push(...ids(page));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && seen.length < 20);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('the last page has no nextCursor, and an exact multiple does not invent an empty page', async () => {
    const { repo } = crowd(4);
    const first = await repo.list({ limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.list({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(ids(second)).toEqual([3, 4]);
    expect(second.nextCursor).toBeNull();
  });

  it('page 2 is stable after an insert that sorts into page 1', async () => {
    const { store, repo } = crowd(6);
    const first = await repo.list({ limit: 2 });
    expect(ids(first)).toEqual([1, 2]);
    // A new user sorts before everything already seen; with offset paging page 2 would repeat id 2.
    store.users.push(user({ id: 99, nickname: 'a-new' }));
    const second = await repo.list({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(ids(second)).toEqual([3, 4]);
  });

  it('breaks nickname ties by id', async () => {
    const { store, repo } = setup();
    // The nickname column is unique in the DB; equal keys only matter for the id tie-break of the cursor.
    store.users = [
      user({ id: 3, nickname: 'same' }),
      user({ id: 1, nickname: 'same' }),
      user({ id: 2, nickname: 'same' }),
    ];
    const first = await repo.list({ limit: 1 });
    const second = await repo.list({
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect([ids(first), ids(second)]).toEqual([[1], [2]]);
  });

  it('puts users without a nickname last and round-trips a NULL key in the cursor', async () => {
    const { store, repo } = setup();
    store.users = [
      user({ id: 1, nickname: null }),
      user({ id: 2, nickname: 'zoe' }),
      user({ id: 3, nickname: null }),
      user({ id: 4, nickname: 'amy' }),
      user({ id: 5, nickname: null }),
    ];
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.list({ limit: 2, population: 'all', cursor });
      seen.push(...ids(page));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && seen.length < 20);
    expect(seen).toEqual([4, 2, 1, 3, 5]);
    // The page that ended on a NULL key carried it in the cursor.
    const mid = await repo.list({ limit: 3, population: 'all' });
    expect(store.criteria.at(-1)?.after).toBeUndefined();
    await repo.list({
      limit: 3,
      population: 'all',
      cursor: mid.nextCursor ?? undefined,
    });
    expect(store.criteria.at(-1)?.after).toEqual({ nickname: null, id: 1 });
  });

  it('the cursor is opaque text, not the raw key', async () => {
    const { repo } = crowd(3);
    const page = await repo.list({ limit: 1 });
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(page.nextCursor).not.toContain('n00');
  });

  it('rejects a cursor that is not ours with InvalidListQueryError on the cursor field', async () => {
    const { repo } = crowd(3);
    const b64 = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const bad of [
      'garbage!',
      '',
      b64({ n: 5, i: 1 }),
      b64({ n: 'a', i: 'x' }),
      b64({ n: 'a' }),
      b64([1, 2]),
      b64({ n: 'a', i: -1 }),
      Buffer.from('not json').toString('base64url'),
    ]) {
      await expect(repo.list({ cursor: bad })).rejects.toMatchObject({
        field: 'cursor',
      });
      await expect(repo.list({ cursor: bad })).rejects.toBeInstanceOf(
        InvalidListQueryError,
      );
    }
  });
});

describe('UsersQueryRepository.list — limit bounds (FR-9)', () => {
  it('defaults to 50 and asks the store for one more row to detect a next page', async () => {
    const { store, repo } = setup();
    await repo.list();
    expect(store.criteria[0]?.take).toBe(51);
  });

  it('accepts 1 and 200', async () => {
    const { store, repo } = setup();
    await repo.list({ limit: 1 });
    await repo.list({ limit: 200 });
    expect(store.criteria.map((c) => c.take)).toEqual([2, 201]);
  });

  it('rejects 0, 201, a fraction and NaN on the limit field', async () => {
    const { repo } = setup();
    for (const bad of [0, 201, -1, 1.5, Number.NaN]) {
      await expect(repo.list({ limit: bad })).rejects.toMatchObject({
        field: 'limit',
      });
    }
  });
});

describe('UsersQueryRepository.list — summary mapping (design 6)', () => {
  it('maps a user with grouped roles, programs and active exclusions', async () => {
    const { store, repo } = setup();
    store.users = [
      user({
        id: 7,
        email: 'ana@cgiar.org',
        firstName: 'Ana',
        lastName: 'Ruiz',
        nickname: 'ana',
        authSource: 'custom',
        invitation: 'sent',
        lastLoginAt: new Date('2026-03-01T10:00:00Z'),
      }),
    ];
    store.grants = [
      { userId: 7, roleCode: 'ASSESSOR', resultTypeKey: 'KP', programId: null },
      {
        userId: 7,
        roleCode: 'ASSESSOR',
        resultTypeKey: 'CAPACITY',
        programId: null,
      },
      { userId: 7, roleCode: 'TPB', resultTypeKey: '*', programId: null },
      { userId: 7, roleCode: 'ADMIN', resultTypeKey: null, programId: null },
    ];
    store.scopes = [
      { userId: 7, programId: 9 },
      { userId: 7, programId: 4 },
    ];
    store.exclusions = [
      exclusion({ id: 11, userId: 7, programId: 4, reason: 'Co-author' }),
      exclusion({
        id: 12,
        userId: 7,
        programId: 9,
        status: 'dismissed',
        origin: 'reporting',
        endedAt: new Date(),
        endedBy: 1,
        endReason: 'ok',
      }),
    ];

    const [summary] = (await repo.list({ population: 'all' })).items;

    expect(summary).toEqual({
      id: 7,
      email: 'ana@cgiar.org',
      firstName: 'Ana',
      lastName: 'Ruiz',
      nickname: 'ana',
      accountType: 'custom',
      status: 'active',
      lastSignInAt: new Date('2026-03-01T10:00:00Z'),
      invitation: 'sent',
      roles: [
        { role: 'ADMIN' },
        { role: 'ASSESSOR', resultTypes: ['CAPACITY', 'KP'] },
        { role: 'TPB', resultTypes: 'all' },
      ],
      programs: [4, 9],
      exclusions: [
        {
          id: 11,
          programId: 4,
          origin: 'manual',
          reason: 'Co-author',
          since: new Date('2026-02-01T00:00:00Z'),
        },
      ],
    });
  });

  it('a user with no program rows has programs "all"; never signed in = null; inactive status', async () => {
    const { store, repo } = setup();
    store.users = [user({ id: 8, isActive: false, nickname: 'x' })];
    const [summary] = (await repo.list({ status: 'all' })).items;
    expect(summary).toMatchObject({
      programs: 'all',
      lastSignInAt: null,
      status: 'inactive',
      roles: [],
      exclusions: [],
    });
  });

  it('"*" wins over concrete keys of the same role', async () => {
    const { store, repo } = setup();
    store.users = [user({ id: 9, nickname: 'y' })];
    store.grants = [
      { userId: 9, roleCode: 'ASSESSOR', resultTypeKey: 'KP', programId: null },
      { userId: 9, roleCode: 'ASSESSOR', resultTypeKey: '*', programId: null },
    ];
    const [summary] = (await repo.list()).items;
    expect(summary?.roles).toEqual([{ role: 'ASSESSOR', resultTypes: 'all' }]);
  });

  it('loads roles, programs and exclusions once per page, not once per user', async () => {
    const { store, repo } = setup();
    store.users = Array.from({ length: 30 }, (_, i) =>
      user({ id: i + 1, nickname: `n${i}` }),
    );
    await repo.list({ limit: 30 });
    expect(store.calls).toEqual({
      grants: 1,
      scopes: 1,
      exclusions: 1,
      actors: 0,
    });
  });

  it('an empty page runs no batch loads', async () => {
    const { store, repo } = setup();
    expect(await repo.list()).toEqual({ items: [], nextCursor: null });
    expect(store.calls).toEqual({
      grants: 0,
      scopes: 0,
      exclusions: 0,
      actors: 0,
    });
  });
});

describe('UsersQueryRepository.get (FR-10)', () => {
  it('returns undefined for an unknown id', async () => {
    const { repo } = setup();
    expect(await repo.get(404)).toBeUndefined();
  });

  it('splits active exclusions from history, with who, when and why; ended_by NULL = system', async () => {
    const { store, repo } = setup();
    store.users = [
      user({ id: 7, nickname: 'ana' }),
      user({ id: 1, nickname: 'root', firstName: 'Ro', lastName: 'Ot' }),
      user({ id: 2, nickname: 'two' }),
    ];
    const ended = new Date('2026-04-01T00:00:00Z');
    store.exclusions = [
      exclusion({ id: 1, userId: 7, programId: 4 }),
      exclusion({
        id: 2,
        userId: 7,
        programId: 5,
        status: 'removed',
        createdBy: 1,
        endedAt: ended,
        endedBy: 2,
        endReason: 'No longer applies',
      }),
      exclusion({
        id: 3,
        userId: 7,
        programId: 6,
        origin: 'reporting',
        reportingRole: 'Science Program Lead',
        reason: null,
        createdBy: null,
        status: 'removed',
        endedAt: ended,
        endedBy: null,
      }),
      exclusion({
        id: 4,
        userId: 7,
        programId: 8,
        origin: 'reporting',
        reportingRole: 'Lead',
        reason: null,
        createdBy: null,
        status: 'dismissed',
        endedAt: ended,
        endedBy: 1,
        endReason: 'Not a conflict',
      }),
      exclusion({ id: 5, userId: 99, programId: 4 }),
    ];

    const detail = await repo.get(7);

    expect(detail?.exclusions.map((e) => e.id)).toEqual([1]);
    expect(detail?.exclusionHistory).toEqual([
      {
        id: 2,
        programId: 5,
        origin: 'manual',
        status: 'removed',
        reason: 'because',
        reportingRole: null,
        since: new Date('2026-02-01T00:00:00Z'),
        createdBy: { id: 1, nickname: 'root', firstName: 'Ro', lastName: 'Ot' },
        endedAt: ended,
        endedBy: { id: 2, nickname: 'two', firstName: null, lastName: null },
        endReason: 'No longer applies',
      },
      {
        id: 3,
        programId: 6,
        origin: 'reporting',
        status: 'removed',
        reason: null,
        reportingRole: 'Science Program Lead',
        since: new Date('2026-02-01T00:00:00Z'),
        createdBy: null,
        endedAt: ended,
        endedBy: null,
        endReason: null,
      },
      {
        id: 4,
        programId: 8,
        origin: 'reporting',
        status: 'dismissed',
        reason: null,
        reportingRole: 'Lead',
        since: new Date('2026-02-01T00:00:00Z'),
        createdBy: null,
        endedAt: ended,
        endedBy: { id: 1, nickname: 'root', firstName: 'Ro', lastName: 'Ot' },
        endReason: 'Not a conflict',
      },
    ]);
    expect(store.calls.actors).toBe(1);
  });

  it('a user with only active exclusions skips the actor lookup', async () => {
    const { store, repo } = setup();
    store.users = [user({ id: 7, nickname: 'ana' })];
    store.exclusions = [
      exclusion({ id: 1, userId: 7, createdBy: null, origin: 'reporting' }),
    ];
    const detail = await repo.get(7);
    expect(detail?.exclusionHistory).toEqual([]);
    expect(store.calls.actors).toBe(0);
  });
});

describe('DrizzleUsersQueryStore (the real adapter over a stub driver)', () => {
  function adapter(rows: unknown[][] = []) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: (query: { sql: string }, values?: unknown[]) => {
        statements.push({ sql: query.sql, values: values ?? [] });
        return Promise.resolve([rows, []]);
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleUsersQueryStore(db), statements };
  }
  const base: UserListCriteria = { status: 'all', population: 'all', take: 51 };

  it('runs one SELECT with ORDER BY nickname NULLS LAST, id and LIMIT, and never OFFSET', async () => {
    const { store, statements } = adapter();
    await store.findPage(base);
    expect(statements).toHaveLength(1);
    const { sql, values } = statements[0]!;
    expect(sql).toMatch(/^select .* from `users`/);
    expect(sql).toMatch(
      /order by `users`\.`nickname` is null asc, `users`\.`nickname` asc, `users`\.`id` asc limit \?$/,
    );
    expect(sql).not.toMatch(/offset/);
    expect(sql).not.toMatch(/ where /);
    expect(values).toEqual([51]);
  });

  it('search is a LIKE on email, nickname, first and last name with %, _ and \\ escaped', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, q: '50%_a\\b' });
    const { sql, values } = statements[0]!;
    expect(sql).toContain(
      '(`users`.`email` like ? or `users`.`nickname` like ? or `users`.`first_name` like ? or `users`.`last_name` like ?)',
    );
    const pattern = '%50\\%\\_a\\\\b%';
    expect(values).toEqual([pattern, pattern, pattern, pattern, 51]);
  });

  it('status and population compile to is_active and the team EXISTS', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, status: 'active', population: 'team' });
    const team = statements[0]!;
    expect(team.sql).toContain('`users`.`is_active` = ?');
    expect(team.sql).toMatch(
      /\(exists \(select 1 from `role_assignments` inner join `roles` on `roles`\.`id` = `role_assignments`\.`role_id` where \(`role_assignments`\.`user_id` = `users`\.`id` and \(`role_assignments`\.`is_active` = \? and `role_assignments`\.`revoked_at` is null and `roles`\.`is_active` = \? and `roles`\.`code` in \(.*\)\)\)\) or `users`\.`created_by` is not null\)/,
    );

    const g = adapter();
    await g.store.findPage({ ...base, population: 'guests' });
    expect(g.statements[0]!.sql).toMatch(
      /not \(exists \(select 1 from `role_assignments` inner join `roles` on .* `roles`\.`is_active` = \? and .*\) or `users`\.`created_by` is not null\)/,
    );
  });

  it('role and resultType share one EXISTS on the same active grant; * matches any result type', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, role: 'ASSESSOR', resultType: 'KP' });
    const { sql, values } = statements[0]!;
    expect(sql).toMatch(
      /exists \(select 1 from `role_assignments` inner join `roles` on .* where .*`roles`\.`code` = \? and \(`role_assignments`\.`result_type_key` = \? or `role_assignments`\.`result_type_key` = \?\)\)/,
    );
    expect(values).toEqual(expect.arrayContaining(['ASSESSOR', 'KP', '*']));
    // Same rule as isLiveAssignment: not revoked, role active and in the catalog.
    expect(sql).toMatch(
      /`role_assignments`\.`revoked_at` is null and `roles`\.`is_active` = \? and `roles`\.`code` in \(/,
    );
    expect(values).toEqual(
      expect.arrayContaining(['ADMIN', 'ASSESSOR', 'LEAD_ASSESSOR']),
    );
  });

  it('programId matches users with no user_programs row or with that program', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, programId: 5 });
    const { sql, values } = statements[0]!;
    expect(sql).toMatch(
      /not exists \(select 1 from `user_programs` where `user_programs`\.`user_id` = `users`\.`id`\) or exists \(select 1 from `user_programs` where .*`user_programs`\.`program_id` = \?/,
    );
    expect(values).toContain(5);
  });

  it('hasExclusions looks at ACTIVE exclusions only, both ways', async () => {
    const yes = adapter();
    await yes.store.findPage({ ...base, hasExclusions: true });
    expect(yes.statements[0]!.sql).toMatch(
      /exists \(select 1 from `user_program_exclusions` where .*`user_program_exclusions`\.`status` = \?\)/,
    );
    expect(yes.statements[0]!.values).toContain('active');
    const no = adapter();
    await no.store.findPage({ ...base, hasExclusions: false });
    expect(no.statements[0]!.sql).toMatch(
      /not exists \(select 1 from `user_program_exclusions`/,
    );
  });

  it('a keyset cursor compiles to a row comparison, not to OFFSET', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, after: { nickname: 'ana', id: 7 } });
    const { sql, values } = statements[0]!;
    expect(sql).toContain(
      '(`users`.`nickname` > ? or (`users`.`nickname` = ? and `users`.`id` > ?) or `users`.`nickname` is null)',
    );
    expect(sql).not.toMatch(/offset/);
    expect(values).toEqual(['ana', 'ana', 7, 51]);
  });

  it('a NULL-key cursor compiles to nickname IS NULL and id > ?', async () => {
    const { store, statements } = adapter();
    await store.findPage({ ...base, after: { nickname: null, id: 7 } });
    const { sql, values } = statements[0]!;
    expect(sql).toContain('(`users`.`nickname` is null and `users`.`id` > ?)');
    expect(values).toEqual([7, 51]);
  });

  it('batch loads use one IN query each and skip the database for an empty id list', async () => {
    const { store, statements } = adapter();
    await store.findActiveGrants([1, 2, 3]);
    await store.findScopes([1, 2, 3]);
    await store.findExclusions([1, 2, 3], true);
    await store.findActors([4, 5]);
    expect(statements).toHaveLength(4);
    expect(statements[0]!.sql).toMatch(
      /from `role_assignments` inner join `roles` .*`role_assignments`\.`user_id` in \(\?, \?, \?\) and \(`role_assignments`\.`is_active` = \? and `role_assignments`\.`revoked_at` is null and `roles`\.`is_active` = \? and `roles`\.`code` in \(/,
    );
    expect(statements[1]!.sql).toMatch(
      /from `user_programs` where `user_programs`\.`user_id` in \(\?, \?, \?\)/,
    );
    expect(statements[2]!.sql).toMatch(
      /from `user_program_exclusions` where .*`user_id` in \(\?, \?, \?\) and .*`status` = \?/,
    );
    expect(statements[3]!.sql).toMatch(
      /from `users` where `users`\.`id` in \(\?, \?\)/,
    );

    const empty = adapter();
    await empty.store.findActiveGrants([]);
    await empty.store.findScopes([]);
    await empty.store.findExclusions([], false);
    await empty.store.findActors([]);
    expect(empty.statements).toHaveLength(0);
  });

  it('findById selects one user by primary key', async () => {
    const { store, statements } = adapter();
    expect(await store.findById(7)).toBeUndefined();
    expect(statements[0]!.sql).toMatch(
      /from `users` where `users`\.`id` = \? limit \?/,
    );
  });
});
