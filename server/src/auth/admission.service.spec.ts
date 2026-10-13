import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from '../../test/support/in-memory-stores.js';
import type { User } from '../database/drizzle/schema/users.js';
import { CurrentUserCache } from '../users/current-user.cache.js';
import { RoleAssignmentsRepository } from '../users/role-assignments.repository.js';
import {
  UsersRepository,
  type ReadOptions,
} from '../users/users.repository.js';
import {
  AdmissionService,
  type AdmissionMode,
  type AdmissionUnitOfWork,
} from './admission.service.js';
import {
  EmailCollisionError,
  EmailNotVerifiedError,
  NoActiveRolesError,
  UserInactiveError,
  UserNotRegisteredError,
} from './auth.errors.js';
import {
  InvalidTokenError,
  type TokenVerifier,
} from './token-verifier.service.js';

// Admission over the in-memory stores: one test per FR-8 row. The verifier is a
// fake that serves the claims registered for a token string; the transaction
// is a fake that records its commit (rollback is not emulated, so the service
// must not write before it has decided to admit).

interface Claims {
  sub: string;
  email?: string;
  username?: string;
  sso?: boolean;
  givenName?: string;
  familyName?: string;
  /** The `email_verified` claim as the token carries it; absent when undefined. */
  emailVerified?: boolean | string;
}

function payload(claims: Claims) {
  return {
    sub: claims.sub,
    ...(claims.email !== undefined && { email: claims.email }),
    ...(claims.emailVerified !== undefined && {
      email_verified: claims.emailVerified,
    }),
    ...(claims.username !== undefined && {
      'cognito:username': claims.username,
    }),
    ...(claims.sso && {
      identities: [{ providerName: 'CGIAR-AzureAD', userId: 'x' }],
    }),
    ...(claims.givenName !== undefined && { given_name: claims.givenName }),
    ...(claims.familyName !== undefined && { family_name: claims.familyName }),
  };
}

/** `datetime` columns hold whole seconds, so values within one second are the same value. */
const wholeSeconds = (value: unknown) =>
  value instanceof Date ? Math.round(value.getTime() / 1000) : value;

function sameRow(a: User, b: User): boolean {
  return (Object.keys(a) as (keyof User)[]).every(
    (key) => wholeSeconds(a[key]) === wholeSeconds(b[key]),
  );
}

/**
 * The users table as one REPEATABLE READ transaction sees it. Plain reads (by
 * id, email or sub) are served from a snapshot taken at the first plain read,
 * so a row another transaction commits afterwards is invisible to them; a
 * locking read (`forUpdate`) sees what is committed now. The transaction sees
 * its own writes, except an UPDATE that leaves the row identical: that creates
 * no new row version, so the snapshot stays as it was (InnoDB reports
 * HA_ERR_RECORD_IS_THE_SAME). An UPDATE is a current read: it matches against
 * the latest committed row, whatever the snapshot holds. Two stores over the
 * same `rows` are two transactions over one table.
 */
class SnapshotUsersStore extends InMemoryUsersStore {
  private snapshot: Map<number, User> | null = null;
  /** Runs just before an insert, to commit "another transaction's" row. */
  beforeInsert: (() => void) | null = null;
  /**
   * Runs once, just before an UPDATE that writes the `sub` of an existing row,
   * to commit "another transaction's" link (the real UPDATE would wait for that
   * commit, then see its row).
   */
  beforeSubWrite: (() => Promise<unknown>) | null = null;

  private async commitRacingLink() {
    const racing = this.beforeSubWrite;
    this.beforeSubWrite = null;
    await racing?.();
  }

  private view(options?: ReadOptions): User[] {
    if (options?.forUpdate) return this.rows;
    this.snapshot ??= new Map(this.rows.map((u) => [u.id, { ...u }]));
    return [...this.snapshot.values()];
  }

  override async findById(id: number, options?: ReadOptions) {
    return this.view(options).find((u) => u.id === id);
  }

  override async findByEmail(email: string, options?: ReadOptions) {
    return this.view(options).find((u) => u.email === email);
  }

  override async findByCognitoSub(sub: string, options?: ReadOptions) {
    return this.view(options).find((u) => u.cognitoSub === sub);
  }

  override async insert(values: Parameters<InMemoryUsersStore['insert']>[0]) {
    this.beforeInsert?.();
    const result = await super.insert(values);
    if (result.kind === 'created') {
      this.snapshot?.set(result.user.id, { ...result.user });
    }
    return result;
  }

  override async update(
    id: number,
    values: Parameters<InMemoryUsersStore['update']>[1],
  ) {
    if (values.cognitoSub != null) await this.commitRacingLink();
    const row = this.rows.find((u) => u.id === id);
    const before = row && { ...row };
    const result = await super.update(id, values);
    if (result.kind === 'updated' && row && before && !sameRow(before, row)) {
      this.snapshot?.set(id, { ...row });
    }
    return result;
  }

  override async linkCognitoSub(id: number, sub: string) {
    await this.commitRacingLink();
    const result = await super.linkCognitoSub(id, sub);
    const row = this.rows.find((u) => u.id === id);
    if (result.kind === 'linked' && row) this.snapshot?.set(id, { ...row });
    return result;
  }
}

function setup(usersStore: InMemoryUsersStore = new InMemoryUsersStore()) {
  const assignmentsStore = new InMemoryRoleAssignmentsStore();
  assignmentsStore.addRole({
    code: 'ADMIN',
    name: 'Admin',
    scopeType: 'global',
    isActive: true,
  });
  const users = new UsersRepository(usersStore);
  const assignments = new RoleAssignmentsRepository(assignmentsStore);
  const events: string[] = [];
  const unitOfWork: AdmissionUnitOfWork = {
    async run(work) {
      const result = await work({ users, assignments });
      events.push('commit');
      return result;
    },
  };
  const tokens = new Map<string, Claims>();
  const verifier = {
    async verifyId(token: string) {
      const claims = tokens.get(token);
      if (!claims) throw new InvalidTokenError();
      return payload(claims);
    },
  } as unknown as TokenVerifier;
  const cache = new CurrentUserCache(users, assignments, () => 1_000);
  const invalidateCache = cache.invalidate.bind(cache);
  vi.spyOn(cache, 'invalidate').mockImplementation((userId: number) => {
    events.push(`invalidate:${userId}`);
    invalidateCache(userId);
  });
  const getBySub = vi.spyOn(cache, 'getBySub');
  const create = vi.spyOn(users, 'create');
  const service = new AdmissionService(verifier, unitOfWork, cache);

  function resolve(claims: Claims, mode: AdmissionMode = 'login') {
    tokens.set('id-token', claims);
    return service.resolve('id-token', { mode });
  }

  return {
    usersStore,
    assignmentsStore,
    users,
    assignments,
    events,
    cache,
    getBySub,
    create,
    service,
    resolve,
  };
}

type Ctx = ReturnType<typeof setup>;

const ana = {
  sub: 'sub-ana',
  email: 'ana@cgiar.org',
  username: 'ana-cognito',
};

/** What an admin does before the first login: a row with an empty sub. */
async function preRegister(
  ctx: Ctx,
  input: {
    email?: string;
    authSource?: 'sso' | 'custom';
    withAdminRole?: boolean;
    isActive?: boolean;
    /** Already logged in once: the sub is linked. */
    sub?: string;
    firstName?: string;
    lastName?: string;
  } = {},
) {
  const user = await ctx.users.create({
    email: input.email ?? ana.email,
    authSource: input.authSource ?? 'sso',
    cognitoSub: input.sub,
    cognitoUsername: input.sub ? ana.username : undefined,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  if (input.isActive === false) user.isActive = false;
  if (input.withAdminRole) {
    await ctx.assignments.create({ userId: user.id, roleCode: 'ADMIN' });
  }
  return user;
}

describe('AdmissionService step 1 (verification)', () => {
  it('lets a token that fails verification through as a 401 and writes nothing', async () => {
    const ctx = setup();
    await expect(
      ctx.service.resolve('unknown-token', { mode: 'login' }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    expect(ctx.usersStore.rows).toHaveLength(0);
    expect(ctx.events).toEqual([]);
  });

  it('refuses a verified token that carries no email (fail closed)', async () => {
    const ctx = setup();
    await expect(
      ctx.resolve({ sub: 'sub-x', sso: true }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    expect(ctx.usersStore.rows).toHaveLength(0);
  });
});

describe('AdmissionService FR-8 table', () => {
  it('SSO first login: creates the user as GUEST (sso, no assignments, no creator) and admits it', async () => {
    const ctx = setup();
    const result = await ctx.resolve({
      ...ana,
      sso: true,
      givenName: 'Ana',
      familyName: 'Lopez',
    });

    expect(ctx.usersStore.rows).toHaveLength(1);
    const row = ctx.usersStore.rows[0];
    expect(row.cognitoSub).toBe('sub-ana');
    expect(row.cognitoUsername).toBe('ana-cognito');
    expect(row.authSource).toBe('sso');
    expect(row.createdBy).toBeNull();
    expect(row.firstName).toBe('Ana');
    expect(row.lastName).toBe('Lopez');
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    expect(result.user.id).toBe(row.id);
    expect(result.user.assignments).toEqual([]);
    expect(result.cognitoUsername).toBe('ana-cognito');
  });

  it('pre-registered by email: links the sub, applies her assignments and corrects auth_source from the token', async () => {
    const ctx = setup();
    // The admin entered `custom`; the token says SSO (it has `identities`).
    const pre = await preRegister(ctx, {
      authSource: 'custom',
      withAdminRole: true,
    });

    const result = await ctx.resolve({ ...ana, sso: true });

    expect(ctx.usersStore.rows).toHaveLength(1);
    expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-ana');
    expect(ctx.usersStore.rows[0].authSource).toBe('sso');
    expect(result.user.id).toBe(pre.id);
    expect(result.user.assignments.map((a) => a.roleCode)).toEqual(['ADMIN']);
  });

  it('pre-registered as sso but logging in with a custom token: auth_source becomes custom', async () => {
    const ctx = setup();
    await preRegister(ctx, { authSource: 'sso', withAdminRole: true });

    await ctx.resolve({ ...ana, emailVerified: true }); // no `identities`

    expect(ctx.usersStore.rows[0].authSource).toBe('custom');
    expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-ana');
  });

  it('email collision: 409, and nothing is linked or created', async () => {
    const ctx = setup();
    const other = await ctx.users.create({
      email: ana.email,
      cognitoSub: 'sub-someone-else',
    });
    const writesBefore = ctx.usersStore.writes;

    await expect(ctx.resolve({ ...ana, sso: true })).rejects.toBeInstanceOf(
      EmailCollisionError,
    );
    await expect(ctx.resolve({ ...ana, sso: true })).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(ctx.usersStore.rows).toHaveLength(1);
    expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-someone-else');
    expect(ctx.usersStore.rows[0].id).toBe(other.id);
    expect(ctx.usersStore.writes).toBe(writesBefore);
    expect(ctx.events).toEqual([]);
  });

  it('custom user not registered: 403 and no row is created', async () => {
    const ctx = setup();

    // Custom: no `identities`. The outcome is captured so that "nothing was
    // created" is asserted first, whatever status came back.
    const outcome = await ctx.resolve({ ...ana }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.usersStore.rows).toHaveLength(0);
    expect(ctx.usersStore.writes).toBe(0);
    expect(ctx.events).toEqual([]);
    expect(outcome).toBeInstanceOf(UserNotRegisteredError);
    expect(outcome).toBeInstanceOf(ForbiddenException);
  });

  it('inactive user: 403 and nothing is written (no sub link, no login date)', async () => {
    const ctx = setup();
    await preRegister(ctx, { isActive: false });
    const writes = ctx.usersStore.writes;

    await expect(ctx.resolve({ ...ana, sso: true })).rejects.toBeInstanceOf(
      UserInactiveError,
    );

    expect(ctx.usersStore.rows[0].cognitoSub).toBeNull();
    expect(ctx.usersStore.rows[0].lastLoginAt).toBeNull();
    expect(ctx.usersStore.writes).toBe(writes);
    expect(ctx.events).toEqual([]);
  });

  it('custom user without assignments: 403 and nothing is written', async () => {
    const ctx = setup();
    await preRegister(ctx, { authSource: 'custom' });
    const writes = ctx.usersStore.writes;

    await expect(
      ctx.resolve({ ...ana, emailVerified: true }),
    ).rejects.toBeInstanceOf(NoActiveRolesError);

    expect(ctx.usersStore.rows[0].cognitoSub).toBeNull();
    expect(ctx.usersStore.writes).toBe(writes);
  });

  it('custom user whose only assignment is on an inactive role: 403 (same live-assignment notion as FR-11)', async () => {
    const ctx = setup();
    const pre = await preRegister(ctx, { authSource: 'custom' });
    ctx.assignmentsStore.addRole({
      code: 'TPB',
      name: 'TPB',
      scopeType: 'result_type',
      isActive: false,
    });
    await ctx.assignments.create({
      userId: pre.id,
      roleCode: 'TPB',
      resultTypeKey: 'k',
    });

    await expect(
      ctx.resolve({ ...ana, emailVerified: true }),
    ).rejects.toBeInstanceOf(NoActiveRolesError);
  });

  it('an SSO user without assignments is admitted (GUEST)', async () => {
    const ctx = setup();
    const pre = await preRegister(ctx);

    const result = await ctx.resolve({ ...ana, sso: true });

    expect(result.user.id).toBe(pre.id);
    expect(result.user.assignments).toEqual([]);
  });

  it('updates last login, email and names when the token differs, lowercasing the email', async () => {
    const ctx = setup();
    await preRegister(ctx, {
      sub: 'sub-ana',
      firstName: 'Ana',
      lastName: 'Lopez',
    });
    ctx.usersStore.rows[0].lastLoginAt = new Date(0);

    const result = await ctx.resolve({
      ...ana,
      email: 'Ana.Lopez@CGIAR.org',
      sso: true,
      givenName: 'Anita',
      familyName: 'Lopez-Diaz',
    });

    const row = ctx.usersStore.rows[0];
    expect(ctx.usersStore.rows).toHaveLength(1);
    expect(row.email).toBe('ana.lopez@cgiar.org');
    expect(row.firstName).toBe('Anita');
    expect(row.lastName).toBe('Lopez-Diaz');
    expect(row.lastLoginAt!.getTime()).toBeGreaterThan(0);
    expect(result.user.email).toBe('ana.lopez@cgiar.org');
    expect(result.user.firstName).toBe('Anita');
  });

  it('keeps stored names when the token carries none', async () => {
    const ctx = setup();
    await preRegister(ctx, { sub: 'sub-ana', firstName: 'Ana' });

    await ctx.resolve({ ...ana, sso: true });

    expect(ctx.usersStore.rows[0].lastLoginAt).toBeInstanceOf(Date);
    expect(ctx.usersStore.rows[0].firstName).toBe('Ana');
  });

  it('a new email already owned by another user is a 409, not a 500', async () => {
    const ctx = setup();
    await preRegister(ctx, { sub: 'sub-ana' });
    await ctx.users.create({ email: 'taken@cgiar.org', cognitoSub: 'sub-t' });

    await expect(
      ctx.resolve({ ...ana, email: 'taken@cgiar.org', sso: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.usersStore.rows[0].email).toBe('ana@cgiar.org');
  });
});

describe('AdmissionService email linking needs a verified email on a custom token (FR-8 step 2)', () => {
  it.each([
    ['absent', undefined],
    ['false', false],
    ['"false"', 'false'],
  ])(
    'a custom token whose email_verified is %s: 403, and nothing is linked or created',
    async (_label, emailVerified) => {
      const ctx = setup();
      const pre = await preRegister(ctx, {
        authSource: 'custom',
        withAdminRole: true,
      });
      const writes = ctx.usersStore.writes;

      // The outcome is captured so that "nothing was linked or created" is
      // asserted first, whatever status came back.
      const outcome = await ctx.resolve({ ...ana, emailVerified }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(ctx.usersStore.rows).toHaveLength(1);
      expect(ctx.usersStore.rows[0].id).toBe(pre.id);
      expect(ctx.usersStore.rows[0].cognitoSub).toBeNull();
      expect(ctx.usersStore.rows[0].lastLoginAt).toBeNull();
      expect(ctx.usersStore.writes).toBe(writes);
      expect(ctx.events).toEqual([]);
      expect(outcome).toBeInstanceOf(EmailNotVerifiedError);
      expect(outcome).toBeInstanceOf(ForbiddenException);
    },
  );

  it.each([
    ['true', true],
    ['"true"', 'true'],
  ])(
    'a custom token whose email_verified is %s links the pre-registered user',
    async (_label, emailVerified) => {
      const ctx = setup();
      const pre = await preRegister(ctx, {
        authSource: 'custom',
        withAdminRole: true,
      });

      const result = await ctx.resolve({ ...ana, emailVerified });

      expect(result.user.id).toBe(pre.id);
      expect(ctx.usersStore.rows).toHaveLength(1);
      expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-ana');
    },
  );

  it.each([
    ['absent', undefined],
    ['false', false],
  ])(
    'an SSO token links the pre-registered user whose email_verified is %s',
    async (_label, emailVerified) => {
      const ctx = setup();
      const pre = await preRegister(ctx, { authSource: 'sso' });

      const result = await ctx.resolve({ ...ana, sso: true, emailVerified });

      expect(result.user.id).toBe(pre.id);
      expect(ctx.usersStore.rows).toHaveLength(1);
      expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-ana');
    },
  );

  it('a custom user already linked by sub does not need email_verified', async () => {
    const ctx = setup();
    const pre = await preRegister(ctx, {
      authSource: 'custom',
      withAdminRole: true,
      sub: 'sub-ana',
    });

    const result = await ctx.resolve({ ...ana });

    expect(result.user.id).toBe(pre.id);
  });

  it('an email held by another sub is still a 409 on an unverified custom token', async () => {
    const ctx = setup();
    await ctx.users.create({
      email: ana.email,
      cognitoSub: 'sub-someone-else',
    });

    await expect(ctx.resolve({ ...ana })).rejects.toBeInstanceOf(
      EmailCollisionError,
    );
    expect(ctx.usersStore.rows[0].cognitoSub).toBe('sub-someone-else');
  });
});

describe('AdmissionService mode refresh (FR-13)', () => {
  it('never creates: an SSO token with no QA user is refused', async () => {
    const ctx = setup();

    await expect(
      ctx.resolve({ ...ana, sso: true }, 'refresh'),
    ).rejects.toBeInstanceOf(UserNotRegisteredError);

    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.usersStore.rows).toHaveLength(0);
  });

  it('reads the database, not the cache: a revoked last assignment is a 403 even with a warm cache', async () => {
    const ctx = setup();
    const pre = await preRegister(ctx, {
      authSource: 'custom',
      sub: 'sub-ana',
    });
    const assignment = await ctx.assignments.create({
      userId: pre.id,
      roleCode: 'ADMIN',
    });
    const warm = await ctx.cache.getBySub('sub-ana'); // warm the cache
    expect(warm?.assignments).toHaveLength(1);
    await ctx.assignments.revoke(assignment.id, pre.id); // cache is now stale
    ctx.getBySub.mockClear();

    await expect(ctx.resolve({ ...ana }, 'refresh')).rejects.toBeInstanceOf(
      NoActiveRolesError,
    );
    expect(ctx.getBySub).not.toHaveBeenCalled();
  });

  it('a deactivated user is a 403', async () => {
    const ctx = setup();
    await preRegister(ctx, { sub: 'sub-ana', isActive: false });

    await expect(
      ctx.resolve({ ...ana, sso: true }, 'refresh'),
    ).rejects.toBeInstanceOf(UserInactiveError);
  });

  it('stamps the last login date like a login (FR-8 step 7), still creating nothing and skipping the cache', async () => {
    const ctx = setup();
    await preRegister(ctx, { sub: 'sub-ana' });
    const row = ctx.usersStore.rows[0];
    row.lastLoginAt = new Date(0);
    ctx.create.mockClear(); // the pre-registration above went through `create`
    ctx.getBySub.mockClear();

    const result = await ctx.resolve({ ...ana, sso: true }, 'refresh');

    expect(result.user.id).toBe(row.id);
    expect(row.lastLoginAt.getTime()).toBeGreaterThan(0);
    expect(ctx.usersStore.rows).toHaveLength(1);
    expect(ctx.create).not.toHaveBeenCalled();
    expect(ctx.getBySub).not.toHaveBeenCalled();
  });
});

describe('AdmissionService concurrent first login (DD-10)', () => {
  /** What another transaction committed for the same person just before our insert. */
  function winnerRow(overrides: Partial<User> = {}): User {
    return {
      id: 99,
      cognitoSub: 'sub-ana',
      cognitoUsername: 'ana-cognito',
      email: 'ana@cgiar.org',
      firstName: null,
      lastName: null,
      authSource: 'sso',
      isActive: true,
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    // Both logins fall in the same second (the clock is frozen), as when two
    // requests race: the loser's UPDATE then leaves the winner's row identical.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads the winner with a locking read after losing the insert, and reads its own update back the same way: a single user, admitted', async () => {
    const store = new SnapshotUsersStore();
    const ctx = setup(store);
    store.beforeInsert = () => {
      store.rows.push(winnerRow());
    };

    await expect(ctx.resolve({ ...ana, sso: true })).resolves.toMatchObject({
      user: { id: 99 },
    });

    expect(store.rows).toHaveLength(1);
  });

  it('a winner whose row differs from the token is updated and admitted', async () => {
    const store = new SnapshotUsersStore();
    const ctx = setup(store);
    store.beforeInsert = () => {
      store.rows.push(winnerRow({ firstName: 'Ana' }));
    };

    await expect(
      ctx.resolve({ ...ana, sso: true, givenName: 'Anita' }),
    ).resolves.toMatchObject({ user: { id: 99, firstName: 'Anita' } });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].firstName).toBe('Anita');
  });

  it('a lost race against a different sub with the same email is a 409', async () => {
    const store = new SnapshotUsersStore();
    const ctx = setup(store);
    store.beforeInsert = () => {
      store.rows.push(winnerRow({ cognitoSub: 'sub-other' }));
    };

    await expect(ctx.resolve({ ...ana, sso: true })).rejects.toBeInstanceOf(
      EmailCollisionError,
    );
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].cognitoSub).toBe('sub-other');
  });
});

describe('AdmissionService concurrent link of the same email (FR-8 step 2, DD-10)', () => {
  beforeEach(() => {
    // Both logins fall in the same second (the clock is frozen), as when two
    // requests race.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * One pre-registered user (empty `sub`) and two transactions over its row.
   * Both read it first; the winner then commits its whole login before the
   * loser's UPDATE of the `sub` runs. Returns how each login ended.
   */
  async function race(winnerClaims: Claims, loserClaims: Claims) {
    const loserStore = new SnapshotUsersStore();
    const loser = setup(loserStore);
    const winner = setup(new SnapshotUsersStore(loserStore.rows));
    const pre = await preRegister(loser, { authSource: 'sso' });
    let winnerResult: Awaited<ReturnType<Ctx['resolve']>> | undefined;
    loserStore.beforeSubWrite = async () => {
      winnerResult = await winner.resolve(winnerClaims);
    };

    const loserOutcome = await loser.resolve(loserClaims).then(
      (result) => result,
      (error: unknown) => error,
    );
    return { pre, rows: loserStore.rows, loser, winnerResult, loserOutcome };
  }

  it('two different subs: the first link is admitted and kept, the other login is a 409 that links nothing', async () => {
    const { pre, rows, loser, winnerResult, loserOutcome } = await race(
      { ...ana, sub: 'sub-first', sso: true },
      { ...ana, sub: 'sub-second', sso: true },
    );

    // State first, so a status alone cannot pass: the first link is intact.
    expect(rows).toHaveLength(1);
    expect(rows[0].cognitoSub).toBe('sub-first');
    expect(winnerResult?.user.id).toBe(pre.id);
    expect(loser.events).toEqual([]);
    expect(loserOutcome).toBeInstanceOf(EmailCollisionError);
    expect(loserOutcome).toBeInstanceOf(ConflictException);
  });

  it('the same sub twice (a double login): the loser finds its own sub linked and is admitted too', async () => {
    const { pre, rows, loser, winnerResult, loserOutcome } = await race(
      { ...ana, sso: true },
      { ...ana, sso: true },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].cognitoSub).toBe('sub-ana');
    expect(winnerResult?.user.id).toBe(pre.id);
    expect(loserOutcome).toMatchObject({ user: { id: pre.id } });
    expect(loser.events).toEqual(['commit', `invalidate:${pre.id}`]);
  });
});

describe('AdmissionService cache invalidation (FR-11, same process)', () => {
  it('invalidates the user once, after the transaction commits', async () => {
    const ctx = setup();

    const result = await ctx.resolve({ ...ana, sso: true });

    expect(ctx.events).toEqual(['commit', `invalidate:${result.user.id}`]);
  });

  it('does not invalidate when the resolve is refused', async () => {
    const ctx = setup();
    await preRegister(ctx, { isActive: false });

    await expect(ctx.resolve({ ...ana, sso: true })).rejects.toBeInstanceOf(
      UserInactiveError,
    );

    expect(ctx.events).toEqual([]);
  });

  it('a cache read right after a name change shows it, without the clock moving', async () => {
    const ctx = setup();
    await preRegister(ctx, { sub: 'sub-ana', firstName: 'Ana' });
    const stale = await ctx.cache.getBySub('sub-ana'); // cached for 60 s
    expect(stale?.firstName).toBe('Ana');

    await ctx.resolve({ ...ana, sso: true, givenName: 'Anita' });

    const fresh = await ctx.cache.getBySub('sub-ana');
    expect(fresh?.firstName).toBe('Anita');
  });

  it('a cache read right after linking the sub finds the pre-registered user', async () => {
    const ctx = setup();
    await preRegister(ctx, { authSource: 'sso' });
    expect(await ctx.cache.getBySub('sub-ana')).toBeUndefined();

    await ctx.resolve({ ...ana, sso: true });

    expect((await ctx.cache.getBySub('sub-ana'))?.email).toBe('ana@cgiar.org');
  });
});
