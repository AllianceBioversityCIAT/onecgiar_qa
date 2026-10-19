import { ConflictException, ForbiddenException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/mysql2';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import type { RoleAssignment } from '../database/drizzle/schema/role-assignments.js';
import type { Role } from '../database/drizzle/schema/roles.js';
import type { User } from '../database/drizzle/schema/users.js';
import { CurrentUserCache } from '../users/current-user.cache.js';
import {
  RoleAssignmentsRepository,
  type AssignmentReadOptions,
} from '../users/role-assignments.repository.js';
import {
  UsersRepository,
  type ReadOptions,
} from '../users/users.repository.js';
import {
  AdmissionService,
  type AdmissionMode,
  type AdmissionUnitOfWork,
} from './admission.service.js';
import { DrizzleAdmissionUnitOfWork } from './admission.unit-of-work.js';
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
  /** The `identities` claim as the token carries it, whatever its shape; overrides `sso`. */
  identities?: unknown;
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
    ...(claims.identities !== undefined && { identities: claims.identities }),
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
 * The read view of one REPEATABLE READ transaction: created by its first plain
 * read, whichever table that read is on, and shared by every table after it.
 */
class ReadView {
  private taken = false;
  private readonly takers: (() => void)[] = [];

  enrol(take: () => void): void {
    this.takers.push(take);
  }

  ensure(): void {
    if (this.taken) return;
    this.taken = true;
    for (const take of this.takers) take();
  }
}

/**
 * The users table as one REPEATABLE READ transaction sees it. Plain reads (by
 * id, email or sub) are served from a snapshot taken at the first plain read
 * of the transaction, so a row another transaction commits afterwards is
 * invisible to them; a locking read (`forUpdate`) sees what is committed now.
 * The transaction sees its own writes, except an UPDATE that leaves the row
 * identical: that creates no new row version, so the snapshot stays as it was
 * (InnoDB reports HA_ERR_RECORD_IS_THE_SAME). An UPDATE is a current read: it
 * matches against the latest committed row, whatever the snapshot holds. Two
 * stores over the same `rows` are two transactions over one table.
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
  /**
   * Runs once, just before the first locking read: "another transaction"
   * commits after this one's snapshot and before its decision (the real
   * `SELECT ... FOR UPDATE` waits for that commit, then reads its row).
   */
  beforeLock: (() => Promise<unknown> | void) | null = null;

  constructor(
    rows: User[] = [],
    private readonly readView = new ReadView(),
  ) {
    super(rows);
    readView.enrol(() => {
      this.snapshot = new Map(this.rows.map((u) => [u.id, { ...u }]));
    });
  }

  private async commitRacingLink() {
    const racing = this.beforeSubWrite;
    this.beforeSubWrite = null;
    await racing?.();
  }

  private async visible(options?: ReadOptions): Promise<User[]> {
    if (options?.forUpdate) {
      const racing = this.beforeLock;
      this.beforeLock = null;
      await racing?.();
      return this.rows;
    }
    this.readView.ensure();
    return [...this.snapshot!.values()];
  }

  override async findById(id: number, options?: ReadOptions) {
    return (await this.visible(options)).find((u) => u.id === id);
  }

  override async findByEmail(email: string, options?: ReadOptions) {
    return (await this.visible(options)).find((u) => u.email === email);
  }

  override async findByCognitoSub(sub: string, options?: ReadOptions) {
    return (await this.visible(options)).find((u) => u.cognitoSub === sub);
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

/**
 * The role assignments and the roles as the same transaction sees them: a
 * plain read of either table is served from the transaction's read view, a
 * locking read (`forShare`, which locks both tables) sees what is committed
 * now.
 */
class SnapshotAssignmentsStore extends InMemoryRoleAssignmentsStore {
  private snapshot: { assignments: RoleAssignment[]; roles: Role[] } = {
    assignments: [],
    roles: [],
  };
  /** Runs once, just before the first locking read, to commit "another transaction's" change. */
  beforeLock: (() => Promise<unknown> | void) | null = null;

  constructor(private readonly readView: ReadView) {
    super();
    readView.enrol(() => {
      this.snapshot = {
        assignments: this.rows.map((a) => ({ ...a })),
        roles: this.roles.map((r) => ({ ...r })),
      };
    });
  }

  override async findActiveViewsByUserId(
    userId: number,
    options?: AssignmentReadOptions,
  ) {
    if (options?.forShare) {
      const racing = this.beforeLock;
      this.beforeLock = null;
      await racing?.();
      return this.viewsOf(this.rows, userId);
    }
    this.readView.ensure();
    return this.viewsOf(this.snapshot.assignments, userId, this.snapshot.roles);
  }
}

/** A users table and an assignments table in one REPEATABLE READ transaction. */
function snapshotStores() {
  const readView = new ReadView();
  return {
    usersStore: new SnapshotUsersStore([], readView),
    assignmentsStore: new SnapshotAssignmentsStore(readView),
  };
}

function setup(
  usersStore: InMemoryUsersStore = new InMemoryUsersStore(),
  assignmentsStore: InMemoryRoleAssignmentsStore = new InMemoryRoleAssignmentsStore(),
) {
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

describe.each(['login', 'refresh'] as const)(
  'AdmissionService step 7 email sync on %s (FR-8)',
  (mode) => {
    it.each([
      ['absent', undefined],
      ['false', false],
      ['"false"', 'false'],
    ])(
      'a linked custom user whose new email is not verified (%s) keeps the stored email, while names and last login still update',
      async (_label, emailVerified) => {
        const ctx = setup();
        await preRegister(ctx, {
          authSource: 'custom',
          withAdminRole: true,
          sub: ana.sub,
          firstName: 'Ana',
        });
        const row = ctx.usersStore.rows[0];
        row.lastLoginAt = new Date(0);

        const result = await ctx.resolve(
          {
            ...ana,
            email: 'Ana.New@CGIAR.org',
            emailVerified,
            givenName: 'Anita',
          },
          mode,
        );

        expect(row.email).toBe('ana@cgiar.org');
        expect(result.user.email).toBe('ana@cgiar.org');
        expect(row.firstName).toBe('Anita');
        expect(row.lastLoginAt!.getTime()).toBeGreaterThan(0);
      },
    );

    it.each([
      ['custom, email_verified true', { emailVerified: true }],
      ['custom, email_verified "true"', { emailVerified: 'true' }],
      ['SSO, email_verified absent', { sso: true }],
      ['SSO, email_verified false', { sso: true, emailVerified: false }],
    ] as [string, Partial<Claims>][])(
      '%s: the new email is stored, lowercased',
      async (_label, flags) => {
        const ctx = setup();
        await preRegister(ctx, {
          authSource: flags.sso ? 'sso' : 'custom',
          withAdminRole: true,
          sub: ana.sub,
        });

        const result = await ctx.resolve(
          { ...ana, ...flags, email: 'Ana.New@CGIAR.org' },
          mode,
        );

        expect(ctx.usersStore.rows[0].email).toBe('ana.new@cgiar.org');
        expect(result.user.email).toBe('ana.new@cgiar.org');
      },
    );
  },
);

describe('AdmissionService SSO classification (FR-8 step 1)', () => {
  // `auth_source = sso` only for a non-empty array of identities.
  const notSso: [string, unknown][] = [
    ['an object', { providerName: 'CGIAR-AzureAD' }],
    ['an empty string', ''],
    ['a non-empty string', 'CGIAR-AzureAD'],
    ['null', null],
    ['an empty array', []],
    ['absent', undefined],
  ];

  it.each(notSso)(
    'identities as %s is custom: a pre-registered user is not linked without email_verified',
    async (_label, identities) => {
      const ctx = setup();
      await preRegister(ctx, { authSource: 'sso', withAdminRole: true });
      const writes = ctx.usersStore.writes;

      const outcome = await ctx.resolve({ ...ana, identities }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(ctx.usersStore.rows[0].cognitoSub).toBeNull();
      expect(ctx.usersStore.writes).toBe(writes);
      expect(outcome).toBeInstanceOf(EmailNotVerifiedError);
    },
  );

  it.each(notSso)(
    'identities as %s is custom: a verified user without active assignments is refused',
    async (_label, identities) => {
      const ctx = setup();
      await preRegister(ctx, { authSource: 'sso' });
      const writes = ctx.usersStore.writes;

      const outcome = await ctx
        .resolve({ ...ana, identities, emailVerified: true })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(ctx.usersStore.rows[0].cognitoSub).toBeNull();
      expect(ctx.usersStore.writes).toBe(writes);
      expect(outcome).toBeInstanceOf(NoActiveRolesError);
    },
  );

  it.each(notSso)(
    'identities as %s is custom: an unknown user is refused and no row is created',
    async (_label, identities) => {
      const ctx = setup();

      const outcome = await ctx
        .resolve({ ...ana, identities, emailVerified: true })
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(ctx.create).not.toHaveBeenCalled();
      expect(ctx.usersStore.rows).toHaveLength(0);
      expect(outcome).toBeInstanceOf(UserNotRegisteredError);
    },
  );
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

describe.each([
  [
    'before the loser locks the row (the lock waits, then reads the winner)',
    'before-lock',
  ],
  [
    "between the loser's lock and its link (only the conditional UPDATE guards it)",
    'before-link',
  ],
] as const)(
  'AdmissionService concurrent link of the same email, winner commits %s (FR-8 step 2, DD-10)',
  (_label, interleaving) => {
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
     * Both snapshot it first; the winner then commits its whole login at the
     * given point of the loser's. Returns how each login ended.
     */
    async function race(winnerClaims: Claims, loserClaims: Claims) {
      const loserStore = new SnapshotUsersStore();
      const loser = setup(loserStore);
      const winner = setup(new SnapshotUsersStore(loserStore.rows));
      const pre = await preRegister(loser, { authSource: 'sso' });
      let winnerResult: Awaited<ReturnType<Ctx['resolve']>> | undefined;
      const commitWinner = async () => {
        winnerResult = await winner.resolve(winnerClaims);
      };
      if (interleaving === 'before-lock') loserStore.beforeLock = commitWinner;
      else loserStore.beforeSubWrite = commitWinner;

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
  },
);

describe('AdmissionService decisions come from locking reads (DD-10)', () => {
  // Another transaction commits after this one's snapshot and before its
  // decision: a plain read would keep serving the old state.

  it.each(['login', 'refresh'] as const)(
    'a deactivation committed after the snapshot is refused on %s, and nothing is written',
    async (mode) => {
      const { usersStore, assignmentsStore } = snapshotStores();
      const ctx = setup(usersStore, assignmentsStore);
      await preRegister(ctx, { sub: ana.sub });
      usersStore.beforeLock = () => {
        usersStore.rows[0].isActive = false;
      };
      const writes = usersStore.writes;

      const outcome = await ctx.resolve({ ...ana, sso: true }, mode).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(usersStore.rows[0].lastLoginAt).toBeNull();
      expect(usersStore.writes).toBe(writes);
      expect(ctx.events).toEqual([]);
      expect(outcome).toBeInstanceOf(UserInactiveError);
    },
  );

  it.each(['login', 'refresh'] as const)(
    'the last assignment revoked after the snapshot refuses a custom user on %s, and nothing is written',
    async (mode) => {
      const { usersStore, assignmentsStore } = snapshotStores();
      const ctx = setup(usersStore, assignmentsStore);
      const pre = await preRegister(ctx, {
        authSource: 'custom',
        sub: ana.sub,
      });
      const assignment = await ctx.assignments.create({
        userId: pre.id,
        roleCode: 'ADMIN',
      });
      assignmentsStore.beforeLock = () =>
        assignmentsStore.revoke(assignment.id, pre.id, new Date());
      const writes = usersStore.writes;

      const outcome = await ctx.resolve({ ...ana }, mode).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(usersStore.rows[0].lastLoginAt).toBeNull();
      expect(usersStore.writes).toBe(writes);
      expect(ctx.events).toEqual([]);
      expect(outcome).toBeInstanceOf(NoActiveRolesError);
    },
  );

  it.each(['login', 'refresh'] as const)(
    'the only role of a custom user deactivated after the snapshot refuses it on %s, and nothing is written',
    async (mode) => {
      const { usersStore, assignmentsStore } = snapshotStores();
      const ctx = setup(usersStore, assignmentsStore);
      await preRegister(ctx, {
        authSource: 'custom',
        sub: ana.sub,
        withAdminRole: true,
      });
      assignmentsStore.beforeLock = () => {
        assignmentsStore.roles.find((r) => r.code === 'ADMIN')!.isActive =
          false;
      };
      const writes = usersStore.writes;

      const outcome = await ctx.resolve({ ...ana }, mode).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(usersStore.rows[0].lastLoginAt).toBeNull();
      expect(usersStore.writes).toBe(writes);
      expect(ctx.events).toEqual([]);
      expect(outcome).toBeInstanceOf(NoActiveRolesError);
    },
  );

  it.each([
    ['an empty-sub pre-registered user', undefined],
    ['a user holding another sub', 'sub-someone-else'],
  ])(
    '%s whose email moved after the snapshot is neither linked nor a collision',
    async (_label, holderSub) => {
      const { usersStore, assignmentsStore } = snapshotStores();
      const ctx = setup(usersStore, assignmentsStore);
      await preRegister(ctx, { sub: holderSub });
      usersStore.beforeLock = () => {
        usersStore.rows[0].email = 'moved@cgiar.org';
      };

      const outcome = await ctx.resolve({ ...ana, sso: true }).then(
        (result) => result,
        (error: unknown) => error,
      );

      expect(usersStore.rows).toHaveLength(2);
      expect(usersStore.rows[0].cognitoSub).toBe(holderSub ?? null);
      expect(usersStore.rows[1].email).toBe('ana@cgiar.org');
      expect(usersStore.rows[1].cognitoSub).toBe('sub-ana');
      expect(outcome).toMatchObject({ user: { id: usersStore.rows[1].id } });
    },
  );
});

describe.each(['login', 'refresh'] as const)(
  'AdmissionService over the real unit of work and adapters on %s (stub MySQL driver, DD-10)',
  (mode) => {
    // Rows as the driver returns them: arrays in each table's column order.
    const at = '2026-01-01 00:00:00';
    const userRow = (authSource: 'sso' | 'custom') => [
      1,
      ana.sub,
      ana.username,
      ana.email,
      null,
      null,
      authSource,
      1,
      null,
      at,
      at,
      null,
      // nickname, invitation, invited_at (appended by migration 0001)
      null,
      'none',
      null,
    ];
    const assignmentRow = [
      10,
      1,
      3,
      null,
      null,
      1,
      at,
      null,
      null,
      null,
      '1:3::',
    ];
    const roleRow = (isActive: 0 | 1) => [
      3,
      'ADMIN',
      'Admin',
      'global',
      isActive,
    ];
    /** A row of the plain read's join: role code, role active, active, revoked at, result type key, program id. */
    const viewRow = ['ADMIN', 1, 1, null, null, null];

    interface Tables {
      users: unknown[][];
      assignments: unknown[][];
      roles: unknown[][];
      views: unknown[][];
    }

    const LOCK = /for (update|share)$/;

    /** The locking reads of a transaction, in order, as `<table> for update|share`. */
    const locks = (statements: string[]) =>
      statements.flatMap((sql) => {
        const lock = LOCK.exec(sql);
        const table = /from `(\w+)`/.exec(sql);
        return lock && table ? [`${table[1]} ${lock[0]}`] : [];
      });

    /**
     * Admission of the user `ana` (linked, active, holding ADMIN) in one
     * transaction over a stub driver that serves a plain SELECT from the
     * snapshot and a locking one (FOR UPDATE / FOR SHARE) from what is
     * committed now, which differs from the snapshot by `committedSince`.
     */
    async function admit(
      authSource: 'sso' | 'custom',
      committedSince: Partial<Tables> = {},
    ) {
      const snapshot: Tables = {
        users: [userRow(authSource)],
        assignments: [assignmentRow],
        roles: [roleRow(1)],
        views: [viewRow],
      };
      const committed = { ...snapshot, ...committedSince };
      const statements: string[] = [];
      const client = {
        query: ({ sql }: { sql: string }) => {
          statements.push(sql);
          if (!sql.startsWith('select')) {
            return Promise.resolve([{ affectedRows: 1 }, []]);
          }
          const tables = LOCK.test(sql) ? committed : snapshot;
          const table = /from `(\w+)`/.exec(sql)?.[1];
          const rows = sql.includes(' join ')
            ? tables.views
            : table === 'role_assignments'
              ? tables.assignments
              : table === 'roles'
                ? tables.roles
                : tables.users;
          return Promise.resolve([rows, []]);
        },
      };
      const db = drizzle({ client: client as never, schema, mode: 'default' });
      const claims: Claims =
        authSource === 'sso' ? { ...ana, sso: true } : { ...ana };
      const verifier = {
        verifyId: () => Promise.resolve(payload(claims)),
      } as unknown as TokenVerifier;
      const cache = { invalidate: () => {} } as unknown as CurrentUserCache;
      const service = new AdmissionService(
        verifier,
        new DrizzleAdmissionUnitOfWork(db),
        cache,
      );
      const outcome = await service.resolve('id-token', { mode }).then(
        (result) => result,
        (error: unknown) => error,
      );
      return { outcome, statements };
    }

    it.each([
      ['its only role is deactivated', { roles: [roleRow(0)] }],
      ['its last assignment is revoked', { assignments: [] }],
    ] as [string, Partial<Tables>][])(
      'a custom user is refused when, after the snapshot, %s; nothing is written',
      async (_label, committedSince) => {
        const { outcome, statements } = await admit('custom', committedSince);

        expect(statements.filter((sql) => sql.startsWith('update'))).toEqual(
          [],
        );
        expect(statements.at(-1)).toBe('rollback');
        expect(outcome).toBeInstanceOf(NoActiveRolesError);
      },
    );

    it('a custom token locks the user row, then its assignments, then their roles by primary key, the last two in share mode', async () => {
      const { outcome, statements } = await admit('custom');

      expect(locks(statements)).toEqual([
        'users for update',
        'role_assignments for share',
        'roles for share',
        'users for update', // step 7's read-back
      ]);
      expect(statements).toContainEqual(
        expect.stringMatching(
          /^select .* from `roles` where `roles`\.`id` in \(\?\) for share$/,
        ),
      );
      expect(statements.at(-1)).toBe('commit');
      expect(outcome).toMatchObject({ user: { id: 1 } });
    });

    it('an SSO token reads its assignments plainly: no lock on role_assignments or roles', async () => {
      const { outcome, statements } = await admit('sso');

      expect(locks(statements)).toEqual([
        'users for update',
        'users for update', // step 7's read-back
      ]);
      const assignmentReads = statements.filter((sql) =>
        sql.includes('from `role_assignments`'),
      );
      expect(assignmentReads).toHaveLength(1);
      expect(assignmentReads[0]).toMatch(/inner join `roles`/);
      expect(assignmentReads[0]).not.toMatch(/for update|for share/);
      expect(statements.at(-1)).toBe('commit');
      expect(outcome).toMatchObject({
        user: { id: 1, assignments: [{ roleCode: 'ADMIN' }] },
      });
    });
  },
);

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
