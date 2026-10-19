import { drizzle } from 'drizzle-orm/mysql2';
import {
  InMemoryDatabase,
  InMemoryUsersAdminUnitOfWork,
} from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import { ROLE_DEFINITIONS, RoleCode } from './permissions.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import {
  AdminGuard,
  DrizzleUsersAdminUnitOfWork,
  lockTargetUser,
  type UsersAdminRepositories,
  type UsersAdminUnitOfWork,
} from './users-admin.unit-of-work.js';
import {
  LastAdminError,
  RoleConflictError,
  UserNotFoundError,
} from './users.errors.js';
import { UsersRepository } from './users.repository.js';

// Expected values come from FR-7 (last admin, also when two admins act at the
// same time), FR-13 (one event per change, none for a refused change), DD-2
// (Assessor/Lead exclusivity under the user row lock), DD-3 (the ADMIN roles
// row lock) and design 7 steps 1-5, written out as literals.

/** A committed world: the six roles, and users and grants seeded outside any transaction. */
function world() {
  const db = new InMemoryDatabase();
  for (const role of ROLE_DEFINITIONS) {
    db.stores.assignments.addRole({
      code: role.code,
      name: role.name,
      scopeType: role.scopeType,
      isActive: true,
    });
  }
  const users = new UsersRepository(db.stores.users);
  const assignments = new RoleAssignmentsRepository(db.stores.assignments);
  return {
    db,
    user: async (email: string, roles: RoleCode[] = []) => {
      const created = await users.create({ email, authSource: 'custom' });
      const grants: Record<string, number> = {};
      for (const roleCode of roles) {
        const grant = await assignments.create({
          userId: created.id,
          roleCode,
          resultTypeKey: roleCode === RoleCode.ASSESSOR ? 'KP' : null,
        });
        grants[roleCode] = grant.id;
      }
      return { id: created.id, grants };
    },
  };
}

const outcomes = (settled: PromiseSettledResult<unknown>[]) =>
  settled.map((s) => s.status);
const failureOf = (settled: PromiseSettledResult<unknown>) =>
  settled.status === 'rejected' ? settled.reason : undefined;

/** Design 7, steps 1, 2, 3 and 5 for "revoke ADMIN from `target`" (the service of T-6 does the same). */
function revokeAdmin(
  unitOfWork: UsersAdminUnitOfWork,
  actorId: number,
  target: { id: number; grants: Record<string, number> },
) {
  return unitOfWork.run(async (repositories) => {
    await lockTargetUser(repositories, target.id);
    await repositories.admins.assertAnotherAdminRemains(target.id);
    await repositories.assignments.revoke(target.grants['ADMIN']!, actorId);
    await repositories.audit.record({
      userId: target.id,
      actorId,
      action: 'role_revoke',
      changes: { role: { before: 'ADMIN', after: null } },
    });
  });
}

const activeAdmins = (db: InMemoryDatabase) =>
  db.assignments.filter(
    (a) =>
      a.isActive && a.roleId === db.roles.find((r) => r.code === 'ADMIN')!.id,
  );

describe('last admin under concurrency (FR-7, DD-3, NFR-5)', () => {
  it('two admins demoting each other at the same time: exactly one succeeds, the other is refused, one admin remains', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

    const settled = await Promise.allSettled([
      revokeAdmin(unitOfWork, ben.id, ana),
      revokeAdmin(unitOfWork, ana.id, ben),
    ]);

    expect(outcomes(settled).sort()).toEqual(['fulfilled', 'rejected']);
    const refusal = settled.map(failureOf).find((f) => f !== undefined);
    expect(refusal).toBeInstanceOf(LastAdminError);
    expect(activeAdmins(db)).toHaveLength(1);
    // FR-13: the refused change left no event, the applied one left exactly one.
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({
      action: 'role_revoke',
      changes: { role: { before: 'ADMIN', after: null } },
    });
  });

  it('with three admins both demotions succeed: the guard counts the others, it does not refuse by reflex', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    await user('cai@cgiar.org', [RoleCode.ADMIN]);
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

    const settled = await Promise.allSettled([
      revokeAdmin(unitOfWork, ben.id, ana),
      revokeAdmin(unitOfWork, ana.id, ben),
    ]);

    expect(outcomes(settled)).toEqual(['fulfilled', 'fulfilled']);
    expect(activeAdmins(db)).toHaveLength(1);
    expect(db.audit).toHaveLength(2);
  });

  it('a sole admin cannot demote themself: refused, nothing changes, no event', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);

    await expect(
      revokeAdmin(new InMemoryUsersAdminUnitOfWork(db), ana.id, ana),
    ).rejects.toBeInstanceOf(LastAdminError);

    expect(activeAdmins(db)).toHaveLength(1);
    expect(db.audit).toEqual([]);
  });

  it('an inactive user holding ADMIN is not an administrator left behind', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    db.users.find((u) => u.id === ben.id)!.isActive = false;

    await expect(
      revokeAdmin(new InMemoryUsersAdminUnitOfWork(db), ana.id, ana),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it('a revoked ADMIN grant is not an administrator left behind', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    await new RoleAssignmentsRepository(db.stores.assignments).revoke(
      ben.grants['ADMIN']!,
      ana.id,
    );

    await expect(
      revokeAdmin(new InMemoryUsersAdminUnitOfWork(db), ana.id, ana),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it('a user who holds other roles but not ADMIN is no administrator left behind', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    await user('ben@cgiar.org', [RoleCode.TPB, RoleCode.ASSESSOR]);

    await expect(
      revokeAdmin(new InMemoryUsersAdminUnitOfWork(db), ana.id, ana),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  // The next two tests are what keeps the one above honest: they show that the
  // fake CAN let both demotions through when the guard is weakened. A fake
  // that serialized whole transactions could not.
  it('without the ADMIN row lock the same two demotions both pass: the fake shows the race', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    const base = new InMemoryUsersAdminUnitOfWork(db);
    // The same guard, minus the lock: it still counts, but nothing orders the two.
    const unlocked: UsersAdminUnitOfWork = {
      run: (work) =>
        base.run((repositories) =>
          work({
            ...repositories,
            admins: new AdminGuard({
              lockAdminRole: async () => undefined,
              countActiveAdmins: (excluding) =>
                repositories.admins.store.countActiveAdmins(excluding),
            }),
          }),
        ),
    };

    const settled = await Promise.allSettled([
      revokeAdmin(unlocked, ben.id, ana),
      revokeAdmin(unlocked, ana.id, ben),
    ]);

    expect(outcomes(settled)).toEqual(['fulfilled', 'fulfilled']);
    expect(activeAdmins(db)).toHaveLength(0);
  });

  it('under REPEATABLE READ the count after the lock is a stale snapshot and both pass: why the unit of work pins READ COMMITTED', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    const repeatableRead = new InMemoryUsersAdminUnitOfWork(
      db,
      'repeatable read',
    );

    const settled = await Promise.allSettled([
      revokeAdmin(repeatableRead, ben.id, ana),
      revokeAdmin(repeatableRead, ana.id, ben),
    ]);

    expect(outcomes(settled)).toEqual(['fulfilled', 'fulfilled']);
    expect(activeAdmins(db)).toHaveLength(0);
  });
});

// DD-2 / T-3 review: the Assessor/Lead rule is a read of the user's grants
// before an insert; it holds only because every writer of one user holds the
// user row lock of the unit of work.
describe('two writers granting opposite roles to one user (DD-2, FR-3)', () => {
  function grant(
    unitOfWork: UsersAdminUnitOfWork,
    userId: number,
    roleCode: RoleCode,
    resultTypeKey: string,
    options: { lockUser?: boolean } = {},
  ) {
    return unitOfWork.run(async (repositories) => {
      if (options.lockUser !== false) {
        await lockTargetUser(repositories, userId);
      }
      await repositories.assignments.create({
        userId,
        roleCode,
        resultTypeKey,
        createdBy: 1,
      });
      await repositories.audit.record({
        userId,
        actorId: 1,
        action: 'role_grant',
        changes: {
          role: { before: null, after: `${roleCode}:${resultTypeKey}` },
        },
      });
    });
  }

  it.each([
    ['the same key', ['KP', 'KP']],
    ['the all-result-types key against a key', ['*', 'KP']],
    ['a key against the all-result-types key', ['KP', '*']],
  ] as [string, [string, string]][])(
    'Assessor and Lead Assessor on %s at the same time: exactly one succeeds',
    async (_label, [assessorKey, leadKey]) => {
      const { db, user } = world();
      const ana = await user('ana@cgiar.org');
      const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

      const settled = await Promise.allSettled([
        grant(unitOfWork, ana.id, RoleCode.ASSESSOR, assessorKey),
        grant(unitOfWork, ana.id, RoleCode.LEAD_ASSESSOR, leadKey),
      ]);

      expect(outcomes(settled).sort()).toEqual(['fulfilled', 'rejected']);
      expect(
        settled.map(failureOf).find((f) => f !== undefined),
      ).toBeInstanceOf(RoleConflictError);
      expect(db.assignments.filter((a) => a.isActive)).toHaveLength(1);
      expect(db.audit).toHaveLength(1);
    },
  );

  it('without the user row lock both grants commit and the user holds both: the fake shows the race', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org');
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

    const settled = await Promise.allSettled([
      grant(unitOfWork, ana.id, RoleCode.ASSESSOR, 'KP', { lockUser: false }),
      grant(unitOfWork, ana.id, RoleCode.LEAD_ASSESSOR, 'KP', {
        lockUser: false,
      }),
    ]);

    expect(outcomes(settled)).toEqual(['fulfilled', 'fulfilled']);
    expect(db.assignments.filter((a) => a.isActive)).toHaveLength(2);
  });

  it('writers of two different users do not wait for each other', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org');
    const ben = await user('ben@cgiar.org');
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

    const settled = await Promise.allSettled([
      grant(unitOfWork, ana.id, RoleCode.ASSESSOR, 'KP'),
      grant(unitOfWork, ben.id, RoleCode.LEAD_ASSESSOR, 'KP'),
    ]);

    expect(outcomes(settled)).toEqual(['fulfilled', 'fulfilled']);
  });
});

describe('the audit event lives and dies with its change (FR-13)', () => {
  it('commits the event together with the change', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);

    await revokeAdmin(new InMemoryUsersAdminUnitOfWork(db), ben.id, ana);

    expect(db.audit).toEqual([
      expect.objectContaining({ userId: ana.id, actorId: ben.id }),
    ]);
    expect(
      db.assignments.find((a) => a.id === ana.grants['ADMIN'])?.isActive,
    ).toBe(false);
  });

  it('a failure after the event is written drops the event and the change, and frees the locks', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org', [RoleCode.ADMIN]);
    const ben = await user('ben@cgiar.org', [RoleCode.ADMIN]);
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);

    await expect(
      unitOfWork.run(async (repositories) => {
        await lockTargetUser(repositories, ana.id);
        await repositories.admins.assertAnotherAdminRemains(ana.id);
        await repositories.assignments.revoke(ana.grants['ADMIN']!, ben.id);
        await repositories.audit.record({
          userId: ana.id,
          actorId: ben.id,
          action: 'role_revoke',
          changes: { role: { before: 'ADMIN', after: null } },
        });
        throw new Error('the service failed after writing');
      }),
    ).rejects.toThrow('the service failed after writing');

    expect(db.audit).toEqual([]);
    expect(
      db.assignments.find((a) => a.id === ana.grants['ADMIN'])?.isActive,
    ).toBe(true);
    // The rolled-back transaction released its locks: the same change now goes through.
    await expect(revokeAdmin(unitOfWork, ben.id, ana)).resolves.toBeUndefined();
    expect(db.audit).toHaveLength(1);
  });

  it('a change another transaction has not committed yet is invisible to it', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org');
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let parked!: () => void;
    const reached = new Promise<void>((resolve) => (parked = resolve));

    const writer = unitOfWork.run(async (repositories) => {
      await repositories.audit.record({
        userId: ana.id,
        actorId: 1,
        action: 'update',
        changes: { nickname: { before: null, after: 'ana' } },
      });
      parked();
      await gate;
    });
    await reached;
    const seen = await unitOfWork.run((repositories) =>
      repositories.audit.findByUserId(ana.id),
    );
    release();
    await writer;

    expect(seen).toEqual([]);
    expect(db.audit).toHaveLength(1);
  });
});

describe('lockTargetUser (design 7, step 1, FR-6)', () => {
  it('returns the user', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org');

    const locked = await new InMemoryUsersAdminUnitOfWork(db).run(
      (repositories) => lockTargetUser(repositories, ana.id),
    );

    expect(locked).toMatchObject({ id: ana.id, email: 'ana@cgiar.org' });
  });

  it('answers 404 USERS_NOT_FOUND for a user that does not exist', async () => {
    const { db } = world();

    const failure = await new InMemoryUsersAdminUnitOfWork(db)
      .run((repositories) => lockTargetUser(repositories, 99))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UserNotFoundError);
    expect((failure as UserNotFoundError).getStatus()).toBe(404);
    expect((failure as UserNotFoundError).getResponse()).toMatchObject({
      code: 'USERS_NOT_FOUND',
    });
  });

  it('two writers of one user run one after the other', async () => {
    const { db, user } = world();
    const ana = await user('ana@cgiar.org');
    const unitOfWork = new InMemoryUsersAdminUnitOfWork(db);
    const trail: string[] = [];
    const edit = (label: string) =>
      unitOfWork.run(async (repositories) => {
        await lockTargetUser(repositories, ana.id);
        trail.push(`${label}:in`);
        await Promise.resolve();
        await Promise.resolve();
        trail.push(`${label}:out`);
      });

    await Promise.all([edit('a'), edit('b')]);

    expect(trail).toEqual(['a:in', 'a:out', 'b:in', 'b:out']);
  });
});

// The real adapters over a stub driver: statements are asserted, as there is
// no disposable MySQL (the shared qadb is never touched).
describe('DrizzleUsersAdminUnitOfWork over a stub MySQL driver', () => {
  const at = '2026-10-19 10:00:00';
  const userRow = [
    7,
    'sub',
    'user',
    'ana@cgiar.org',
    null,
    null,
    'custom',
    1,
    null,
    at,
    at,
    null,
    null,
    'none',
    null,
  ];
  const roleRow = [3, 'ADMIN', 'Admin', 'global', 1];
  const auditRow = [
    11,
    7,
    1,
    'role_revoke',
    { role: { before: 'ADMIN', after: null } },
    null,
    at,
  ];

  interface Statement {
    via: 'pool' | 'tx';
    sql: string;
  }

  function stub(admins = 2) {
    const log: Statement[] = [];
    const answer = (via: Statement['via']) => ({
      query: ({ sql }: { sql: string }) => {
        log.push({ via, sql });
        if (sql.startsWith('insert')) {
          return Promise.resolve([{ insertId: 11, affectedRows: 1 }, []]);
        }
        if (!sql.startsWith('select')) {
          return Promise.resolve([{ affectedRows: 1 }, []]);
        }
        const rows = sql.includes('count(distinct')
          ? [[admins]]
          : sql.includes('from `user_audit_events`')
            ? [auditRow]
            : sql.includes('from `roles`')
              ? [roleRow]
              : [userRow];
        return Promise.resolve([rows, []]);
      },
    });
    // A pool, as in production: a transaction takes one connection from it.
    const pool = {
      ...answer('pool'),
      getConnection: async () => ({ ...answer('tx'), release: () => {} }),
    };
    const db = drizzle({ client: pool as never, schema, mode: 'default' });
    return { unitOfWork: new DrizzleUsersAdminUnitOfWork(db), log };
  }

  const steps = (repositories: UsersAdminRepositories) =>
    lockTargetUser(repositories, 7)
      .then(() => repositories.admins.assertAnotherAdminRemains(7))
      .then(() =>
        repositories.audit.record({
          userId: 7,
          actorId: 1,
          action: 'role_revoke',
          changes: { role: { before: 'ADMIN', after: null } },
        }),
      );

  it('opens a READ COMMITTED transaction: the last-admin count after the lock reads what is committed now', async () => {
    const { unitOfWork, log } = stub();

    await unitOfWork.run(steps);

    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
  });

  it('locks the user row, then the ADMIN roles row, FOR UPDATE, and only then counts (design 7, steps 1 and 2)', async () => {
    const { unitOfWork, log } = stub();

    await unitOfWork.run(steps);

    const selects = log
      .map((s) => s.sql)
      .filter((sql) => sql.startsWith('select'));
    expect(selects[0]).toMatch(
      /from `users` where `users`\.`id` = \? limit \? for update$/,
    );
    expect(selects[1]).toMatch(
      /from `roles` where `roles`\.`code` = \? limit \? for update$/,
    );
    expect(selects[2]).toMatch(/count\(distinct `users`\.`id`\)/);
    expect(selects[2]).toMatch(/inner join `roles`/);
    expect(selects[2]).toMatch(/inner join `users`/);
    expect(selects[2]).toMatch(/`users`\.`id` <> \?/);
    expect(selects[2]).not.toMatch(/for update|for share/);
  });

  it('counts only live admin grants, as isLiveAssignment does: not revoked, role active and known', async () => {
    const { unitOfWork, log } = stub();

    await unitOfWork.run(steps);

    const count = log
      .map((s) => s.sql)
      .find((sql) => sql.includes('count(distinct'))!;
    expect(count).toMatch(/`role_assignments`\.`revoked_at` is null/);
    expect(count).toMatch(/`roles`\.`is_active` = \?/);
    expect(count).toMatch(/`role_assignments`\.`is_active` = \?/);
    expect(count).toMatch(/`roles`\.`code` in \(/);
  });

  it('every statement, the audit insert included, runs on the transaction connection between begin and commit', async () => {
    const { unitOfWork, log } = stub();

    await unitOfWork.run(steps);

    expect(log.every((s) => s.via === 'tx')).toBe(true);
    const sqls = log.map((s) => s.sql);
    const insert = sqls.findIndex((sql) =>
      sql.startsWith('insert into `user_audit_events`'),
    );
    expect(insert).toBeGreaterThan(sqls.indexOf('begin'));
    expect(insert).toBeLessThan(sqls.indexOf('commit'));
    expect(sqls.at(-1)).toBe('commit');
  });

  it('a failure rolls back: the audit insert was inside the transaction and no commit follows', async () => {
    const { unitOfWork, log } = stub();

    await expect(
      unitOfWork.run(async (repositories) => {
        await steps(repositories);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const sqls = log.map((s) => s.sql);
    expect(log.every((s) => s.via === 'tx')).toBe(true);
    expect(
      sqls.some((sql) => sql.startsWith('insert into `user_audit_events`')),
    ).toBe(true);
    expect(sqls).not.toContain('commit');
    expect(sqls.at(-1)).toBe('rollback');
  });

  it('refuses with USERS_LAST_ADMIN when no other active admin is counted, and rolls back', async () => {
    const { unitOfWork, log } = stub(0);

    await expect(unitOfWork.run(steps)).rejects.toBeInstanceOf(LastAdminError);

    const sqls = log.map((s) => s.sql);
    expect(sqls.some((sql) => sql.startsWith('insert'))).toBe(false);
    expect(sqls.at(-1)).toBe('rollback');
  });
});
