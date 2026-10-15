import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from '../../test/support/in-memory-stores.js';
import type { AssignmentView } from './authorization.service.js';
import {
  CURRENT_USER_TTL_MS,
  CurrentUserCache,
  isAdmitted,
  isLiveAssignment,
  type AuthenticatedUser,
} from './current-user.cache.js';
import { ROLE_DEFINITIONS } from './permissions.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
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
  const users = new UsersRepository(usersStore);
  const assignments = new RoleAssignmentsRepository(assignmentsStore);
  const clock = { now: 5_000_000 };
  const cache = new CurrentUserCache(users, assignments, () => clock.now);
  return { usersStore, assignmentsStore, users, assignments, clock, cache };
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

function userOf(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    email: 'ana@cgiar.org',
    firstName: null,
    lastName: null,
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
  it.each<[string, Partial<AuthenticatedUser>, boolean]>([
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
