import {
  InMemoryRoleAssignmentsStore,
  InMemoryUserProgramsStore,
  InMemoryUsersStore,
} from '../../test/support/in-memory-stores.js';
import {
  AuthorizationService,
  type AssignmentView,
} from './authorization.service.js';
import {
  CURRENT_USER_TTL_MS,
  CurrentUserCache,
  isAdmitted,
  isLiveAssignment,
  type AdmittedUser,
} from './current-user.cache.js';
import { Permission, ROLE_DEFINITIONS } from './permissions.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UserProgramsRepository } from './user-programs.repository.js';
import { UsersRepository } from './users.repository.js';

// The cache is exercised over the in-memory stores with a hand-moved clock, so
// no timer, database or network is involved.

class CountingUsersStore extends InMemoryUsersStore {
  lookups = 0;
  override async findByCognitoSub(sub: string) {
    this.lookups++;
    return super.findByCognitoSub(sub);
  }
}

/** Reads the views at once but hands them over only when `release()` is called. */
class GatedAssignmentsStore extends InMemoryRoleAssignmentsStore {
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  private onParked: (() => void) | null = null;

  /** Resolves when a read has taken its snapshot and waits at the gate. */
  hold(): Promise<void> {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
    return new Promise((resolve) => {
      this.onParked = resolve;
    });
  }

  release(): void {
    this.gate = null;
    this.open?.();
  }

  override async findActiveViewsByUserId(userId: number) {
    const views = await super.findActiveViewsByUserId(userId);
    if (this.gate) {
      const gate = this.gate;
      this.onParked?.();
      await gate;
    }
    return views;
  }
}

function setup() {
  const usersStore = new CountingUsersStore();
  const assignmentsStore = new GatedAssignmentsStore();
  for (const role of ROLE_DEFINITIONS) {
    assignmentsStore.addRole({
      code: role.code,
      name: role.name,
      scopeType: role.scopeType,
      isActive: true,
    });
  }
  const programsStore = new InMemoryUserProgramsStore();
  const users = new UsersRepository(usersStore);
  const assignments = new RoleAssignmentsRepository(assignmentsStore);
  const programs = new UserProgramsRepository(programsStore);
  const clock = { now: 5_000_000 };
  const cache = new CurrentUserCache(
    users,
    assignments,
    programs,
    () => clock.now,
  );
  return {
    usersStore,
    assignmentsStore,
    programsStore,
    users,
    assignments,
    programs,
    clock,
    cache,
  };
}

describe('CurrentUserCache', () => {
  it('loads the user by sub with its active assignments', async () => {
    const { users, assignments, cache } = setup();
    const created = await users.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-ana',
      firstName: 'Ana',
      lastName: 'Diaz',
      authSource: 'custom',
    });
    await assignments.create({
      userId: created.id,
      roleCode: 'ASSESSOR',
      resultTypeKey: 'KP',
    });
    const revoked = await assignments.create({
      userId: created.id,
      roleCode: 'TPB',
    });
    await assignments.revoke(revoked.id, created.id);

    const user = await cache.getBySub('sub-ana');

    expect(user).toMatchObject({
      id: created.id,
      email: 'ana@cgiar.org',
      firstName: 'Ana',
      lastName: 'Diaz',
      authSource: 'custom',
      isActive: true,
    });
    expect(user?.assignments).toEqual([
      expect.objectContaining({
        roleCode: 'ASSESSOR',
        resultTypeKey: 'KP',
        programId: null,
      }),
    ]);
  });

  it('answers undefined for a sub without a QA user and does not remember that', async () => {
    const { usersStore, users, cache } = setup();
    expect(await cache.getBySub('sub-late')).toBeUndefined();

    await users.create({ email: 'late@cgiar.org', cognitoSub: 'sub-late' });

    expect(await cache.getBySub('sub-late')).toMatchObject({
      email: 'late@cgiar.org',
    });
    expect(usersStore.lookups).toBe(2);
  });

  it('serves a loaded user from memory inside the TTL, hiding later changes', async () => {
    const { usersStore, users, assignments, cache, clock } = setup();
    const created = await users.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-ana',
    });
    const grant = await assignments.create({
      userId: created.id,
      roleCode: 'ADMIN',
    });
    await cache.getBySub('sub-ana');

    await assignments.revoke(grant.id, created.id);
    clock.now += CURRENT_USER_TTL_MS - 1;
    const user = await cache.getBySub('sub-ana');

    expect(user?.assignments).toHaveLength(1);
    expect(usersStore.lookups).toBe(1);
  });

  it('reloads once the 60 s bound is reached', async () => {
    const { usersStore, users, assignments, cache, clock } = setup();
    const created = await users.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-ana',
    });
    const grant = await assignments.create({
      userId: created.id,
      roleCode: 'ADMIN',
    });
    await cache.getBySub('sub-ana');
    await assignments.revoke(grant.id, created.id);

    clock.now += CURRENT_USER_TTL_MS;
    const user = await cache.getBySub('sub-ana');

    expect(CURRENT_USER_TTL_MS).toBe(60_000);
    expect(user?.assignments).toEqual([]);
    expect(usersStore.lookups).toBe(2);
  });

  it('counts the bound from the load, not from the last read', async () => {
    const { usersStore, users, cache, clock } = setup();
    await users.create({ email: 'ana@cgiar.org', cognitoSub: 'sub-ana' });
    await cache.getBySub('sub-ana'); // t = 0

    clock.now += 40_000;
    await cache.getBySub('sub-ana'); // a read does not extend the entry
    clock.now += 20_000; // t = 60 s
    await cache.getBySub('sub-ana');

    expect(usersStore.lookups).toBe(2);
  });

  describe('invalidate', () => {
    it('makes the next read reload that user at once', async () => {
      const { usersStore, users, assignments, cache } = setup();
      const created = await users.create({
        email: 'ana@cgiar.org',
        cognitoSub: 'sub-ana',
      });
      const grant = await assignments.create({
        userId: created.id,
        roleCode: 'ADMIN',
      });
      await cache.getBySub('sub-ana');
      await assignments.revoke(grant.id, created.id);

      cache.invalidate(created.id);
      const user = await cache.getBySub('sub-ana');

      expect(user?.assignments).toEqual([]);
      expect(usersStore.lookups).toBe(2);
    });

    it('leaves the other users cached', async () => {
      const { usersStore, users, cache } = setup();
      const ana = await users.create({
        email: 'ana@cgiar.org',
        cognitoSub: 'sub-ana',
      });
      await users.create({ email: 'bo@cgiar.org', cognitoSub: 'sub-bo' });
      await cache.getBySub('sub-ana');
      await cache.getBySub('sub-bo');
      expect(usersStore.lookups).toBe(2);

      cache.invalidate(ana.id);
      await cache.getBySub('sub-bo');
      expect(usersStore.lookups).toBe(2);
      await cache.getBySub('sub-ana');
      expect(usersStore.lookups).toBe(3);
    });

    it('is harmless for a user that is not cached', () => {
      const { cache } = setup();
      expect(() => cache.invalidate(999)).not.toThrow();
    });

    it('is not undone by a load that was already in flight', async () => {
      const { usersStore, users, assignments, assignmentsStore, cache } =
        setup();
      const created = await users.create({
        email: 'ana@cgiar.org',
        cognitoSub: 'sub-ana',
      });
      const grant = await assignments.create({
        userId: created.id,
        roleCode: 'ADMIN',
      });

      // The load reads the ADMIN grant, then stalls before returning it.
      const parked = assignmentsStore.hold();
      const inFlight = cache.getBySub('sub-ana');
      await parked;

      // Meanwhile the grant is revoked and the writer invalidates.
      await assignments.revoke(grant.id, created.id);
      cache.invalidate(created.id);
      assignmentsStore.release();
      await inFlight;

      // The stale load must not have been stored: the next read is fresh.
      const user = await cache.getBySub('sub-ana');
      expect(user?.assignments).toEqual([]);
      expect(usersStore.lookups).toBe(2);
    });
  });

  it('hands out a frozen copy, so neither a handler nor a store write changes it', async () => {
    const { users, assignments, cache } = setup();
    const created = await users.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-ana',
    });
    await assignments.create({ userId: created.id, roleCode: 'ADMIN' });

    const user = (await cache.getBySub('sub-ana'))!;
    created.email = 'changed@cgiar.org'; // the stored row, not the cached copy

    expect(user.email).toBe('ana@cgiar.org');
    expect(Object.isFrozen(user)).toBe(true);
    expect(Object.isFrozen(user.assignments)).toBe(true);
    expect(Object.isFrozen(user.assignments[0])).toBe(true);
  });
});

describe('CurrentUserCache program scope and exclusions (FR-4, FR-6, D5)', () => {
  const authorization = new AuthorizationService();

  async function ana(roles: Array<[string, string | undefined]> = []) {
    const ctx = setup();
    const created = await ctx.users.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-ana',
      authSource: 'custom',
    });
    for (const [roleCode, resultTypeKey] of roles) {
      await ctx.assignments.create({
        userId: created.id,
        roleCode,
        resultTypeKey,
      });
    }
    return { ...ctx, id: created.id };
  }

  it('loads the program scope and only the active exclusions with the user', async () => {
    const { programs, programsStore, cache, id } = await ana();
    await programs.replaceScope(id, [5, 6]);
    const ended = await programs.addManualExclusion({
      userId: id,
      programId: 5,
      reason: 'old',
      createdBy: id,
    });
    await programs.removeManualExclusion({
      userId: id,
      exclusionId: ended.id,
      endedBy: id,
    });
    await programsStore.insertExclusion({
      userId: id,
      programId: 6,
      origin: 'reporting',
      reportingRole: 'Science Program Lead',
    });

    const user = await cache.getBySub('sub-ana');

    expect(user?.programScope).toEqual([5, 6]);
    expect(user?.exclusions).toEqual([{ programId: 6, status: 'active' }]);
  });

  it('a user with nothing set loads an empty scope and no exclusions: all programs', async () => {
    const { cache } = await ana();

    const user = await cache.getBySub('sub-ana');

    expect(user?.programScope).toEqual([]);
    expect(user?.exclusions).toEqual([]);
  });

  it('hands out the scope and the exclusions frozen', async () => {
    const { programs, cache, id } = await ana();
    await programs.replaceScope(id, [5]);
    await programs.addManualExclusion({
      userId: id,
      programId: 5,
      reason: 'r',
      createdBy: id,
    });

    const user = (await cache.getBySub('sub-ana'))!;

    expect(Object.isFrozen(user.programScope)).toBe(true);
    expect(Object.isFrozen(user.exclusions)).toBe(true);
    expect(Object.isFrozen(user.exclusions[0])).toBe(true);
  });

  it('keeps serving the loaded scope and exclusions until `invalidate`, then reads them fresh', async () => {
    const { programs, cache, id } = await ana();
    await programs.replaceScope(id, [5]);
    expect((await cache.getBySub('sub-ana'))?.programScope).toEqual([5]);

    await programs.replaceScope(id, [6, 7]);
    await programs.addManualExclusion({
      userId: id,
      programId: 6,
      reason: 'r',
      createdBy: id,
    });
    const stale = await cache.getBySub('sub-ana');
    expect(stale?.programScope).toEqual([5]);
    expect(stale?.exclusions).toEqual([]);

    cache.invalidate(id);

    const fresh = await cache.getBySub('sub-ana');
    expect(fresh?.programScope).toEqual([6, 7]);
    expect(fresh?.exclusions).toEqual([{ programId: 6, status: 'active' }]);
  });

  it('invalidating another user leaves this one cached', async () => {
    const { programs, cache, id } = await ana();
    await cache.getBySub('sub-ana');
    await programs.replaceScope(id, [5]);

    cache.invalidate(id + 100);

    expect((await cache.getBySub('sub-ana'))?.programScope).toEqual([]);
  });

  it('feeds the review decision: an active exclusion removes the program, the scope limits the rest', async () => {
    const { programs, cache, id } = await ana([['ASSESSOR', '*']]);
    await programs.replaceScope(id, [5, 6]);
    await programs.addManualExclusion({
      userId: id,
      programId: 6,
      reason: 'conflict',
      createdBy: id,
    });
    const user = (await cache.getBySub('sub-ana'))!;
    const review = (programId: number) =>
      authorization.canReview(user, Permission.ASSESSOR_ACCESS, {
        resultType: 'KP',
        programId,
      });

    expect(review(5)).toBe(true);
    expect(review(6)).toBe(false); // listed, but excluded
    expect(review(7)).toBe(false); // not listed
  });

  it('an active ADMIN stays exempt from the loaded scope and exclusions (DD-13)', async () => {
    const { programs, cache, id } = await ana([['ADMIN', undefined]]);
    await programs.replaceScope(id, [5]);
    await programs.addManualExclusion({
      userId: id,
      programId: 5,
      reason: 'conflict',
      createdBy: id,
    });
    const user = (await cache.getBySub('sub-ana'))!;

    expect(
      authorization.canReview(user, Permission.ASSESSOR_ACCESS, {
        resultType: 'KP',
        programId: 5,
      }),
    ).toBe(true);
    expect(
      authorization.canReview(user, Permission.ASSESSOR_ACCESS, {
        resultType: 'KP',
        programId: 9,
      }),
    ).toBe(true);
  });
});

function view(overrides: Partial<AssignmentView> = {}): AssignmentView {
  return {
    roleCode: 'ADMIN',
    roleIsActive: true,
    isActive: true,
    revokedAt: null,
    resultTypeKey: null,
    programId: null,
    ...overrides,
  };
}

function userOf(overrides: Partial<AdmittedUser> = {}): AdmittedUser {
  return {
    id: 1,
    email: 'ana@cgiar.org',
    firstName: null,
    lastName: null,
    nickname: null,
    authSource: 'sso',
    isActive: true,
    assignments: [],
    ...overrides,
  };
}

describe('isLiveAssignment', () => {
  it.each<[string, Partial<AssignmentView>, boolean]>([
    ['an active assignment of a known active role', {}, true],
    ['a revoked assignment', { revokedAt: new Date() }, false],
    ['an inactive assignment', { isActive: false }, false],
    ['an assignment of an inactive role', { roleIsActive: false }, false],
    [
      'an assignment of a role the catalog does not know',
      { roleCode: 'ROGUE' },
      false,
    ],
  ])('%s -> %s', (_name, overrides, expected) => {
    expect(isLiveAssignment(view(overrides))).toBe(expected);
  });
});

describe('isAdmitted (FR-11)', () => {
  it.each<[string, Partial<AdmittedUser>, boolean]>([
    ['an active SSO user without assignments (GUEST)', {}, true],
    ['an active SSO user with assignments', { assignments: [view()] }, true],
    ['an inactive SSO user', { isActive: false }, false],
    [
      'an inactive custom user with assignments',
      { authSource: 'custom', isActive: false, assignments: [view()] },
      false,
    ],
    ['a custom user without assignments', { authSource: 'custom' }, false],
    [
      'a custom user with a live assignment',
      { authSource: 'custom', assignments: [view()] },
      true,
    ],
    [
      'a custom user with only a revoked assignment',
      { authSource: 'custom', assignments: [view({ revokedAt: new Date() })] },
      false,
    ],
    [
      'a custom user with only an assignment of an inactive role',
      { authSource: 'custom', assignments: [view({ roleIsActive: false })] },
      false,
    ],
    [
      'a user whose auth source is not a known value',
      { authSource: 'other' as never, assignments: [view()] },
      false,
    ],
  ])('%s -> %s', (_name, overrides, expected) => {
    expect(isAdmitted(userOf(overrides))).toBe(expected);
  });
});
