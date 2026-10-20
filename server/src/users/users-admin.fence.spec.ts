import { HttpException, Logger } from '@nestjs/common';
import {
  adminWorld,
  type AdminWorld,
  type SeedUser,
} from '../../test/support/users-admin-world.js';
import type { InMemoryDatabase } from '../../test/support/in-memory-stores.js';
import { IDEMPOTENCY_LEASE_MS } from '../common/idempotency/idempotency.store.js';
import type { CognitoAdminClient } from '../auth/cognito-admin.client.js';
import type { CatalogService } from './catalogs/catalog.service.js';
import type { CurrentUserCache } from './current-user.cache.js';
import { UsersAdminService, type AdminContext } from './users-admin.service.js';
import type {
  UsersAdminRepositories,
  UsersAdminUnitOfWork,
} from './users-admin.unit-of-work.js';

// The exactly-once fence of users-admin-write-safety (FR-2 mark executed in
// the same commit as the change; FR-3 no second effect; FR-5 a stalled first
// request cannot commit after a take-over; NFR-1). Expected values are the
// spec's, written out as literals. Every proof of "same transaction" is made
// on the transaction's own state (what a failed commit drops, what another
// connection can or cannot see), never by spying that `markExecuted` was called.

/** Every `log`-level line the service wrote; the console stays quiet. */
const infoLines: string[] = [];
beforeEach(() => {
  infoLines.length = 0;
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
      if (level === 'log') infoLines.push(String(message));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Service = UsersAdminService;
type Outcome = { userId: number };

interface Row {
  name: string;
  /** Extra seed for the target (defaults: an active custom user invited, never signed in, one ASSESSOR KP grant). */
  seed?: Partial<SeedUser>;
  /** Extra arrangement before the call (an exclusion to remove or dismiss). */
  prepare?: (
    w: AdminWorld,
    target: { id: number },
    actorId: number,
  ) => Promise<void>;
  /** The mutation; `n` varies the values so a second call is a different request. */
  call: (
    s: Service,
    ctx: AdminContext,
    id: number,
    w: AdminWorld,
    n: number,
  ) => Promise<Outcome>;
  /** Audit events one execution writes (design 7 / core DD-15). */
  audits: number;
  /** False for `create`, which has no target before it runs. */
  byId?: boolean;
}

const createCommand = (n: number) => ({
  email: `new${n}@cgiar.org`,
  firstName: 'Nia',
  lastName: 'Okoro',
  nickname: `Nia ${n}`,
  accountType: 'sso' as const,
});

const CHANGING: Row[] = [
  {
    name: 'create',
    call: (s, ctx, _id, _w, n) => s.create(ctx, createCommand(n)),
    audits: 1,
    byId: false,
  },
  {
    name: 'edit',
    call: (s, ctx, id, _w, n) => s.edit(ctx, id, { nickname: `Ana ${n}` }),
    audits: 1,
  },
  {
    name: 'replaceRoles',
    call: (s, ctx, id) =>
      s.replaceRoles(ctx, id, [{ role: 'ASSESSOR', resultTypes: ['POLICY'] }]),
    audits: 2,
  },
  {
    name: 'replacePrograms',
    call: (s, ctx, id) => s.replacePrograms(ctx, id, [1, 2]),
    audits: 1,
  },
  {
    name: 'addExclusion',
    call: (s, ctx, id) =>
      s.addExclusion(ctx, id, { programId: 1, reason: 'Co-author' }),
    audits: 1,
  },
  {
    name: 'removeExclusion',
    prepare: async (w, target, actorId) => {
      await w.programs.addManualExclusion({
        userId: target.id,
        programId: 1,
        reason: 'Co-author',
        createdBy: actorId,
      });
    },
    call: (s, ctx, id, w) => s.removeExclusion(ctx, id, w.db.exclusions[0]!.id),
    audits: 1,
  },
  {
    name: 'dismissExclusion',
    prepare: async (w, target) => {
      await w.db.stores.programs.insertExclusion({
        userId: target.id,
        programId: 3,
        origin: 'reporting',
        reportingRole: 'Lead',
        createdBy: null,
      });
    },
    call: (s, ctx, id, w) =>
      s.dismissExclusion(ctx, id, w.db.exclusions[0]!.id, 'Not relevant'),
    audits: 1,
  },
  {
    name: 'deactivate',
    call: (s, ctx, id) => s.deactivate(ctx, id),
    audits: 1,
  },
  {
    name: 'activate',
    seed: { isActive: false },
    call: (s, ctx, id) => s.activate(ctx, id),
    audits: 1,
  },
  {
    name: 'resendInvitation',
    call: (s, ctx, id) => s.resendInvitation(ctx, id),
    audits: 1,
  },
];

/** Requests that ask for what already holds: nothing is written, the key is still marked (design 7). */
const NO_OPS: Row[] = [
  {
    name: 'edit (same nickname)',
    call: (s, ctx, id) => s.edit(ctx, id, { nickname: 'Ana' }),
    audits: 0,
  },
  {
    name: 'replaceRoles (same grants)',
    call: (s, ctx, id) =>
      s.replaceRoles(ctx, id, [{ role: 'ASSESSOR', resultTypes: ['KP'] }]),
    audits: 0,
  },
  {
    name: 'replacePrograms (already all)',
    call: (s, ctx, id) => s.replacePrograms(ctx, id, 'all'),
    audits: 0,
  },
  {
    name: 'deactivate (already inactive)',
    seed: { isActive: false },
    call: (s, ctx, id) => s.deactivate(ctx, id),
    audits: 0,
  },
  {
    name: 'activate (already active)',
    call: (s, ctx, id) => s.activate(ctx, id),
    audits: 0,
  },
];

async function arrange(row: Row) {
  const w = adminWorld();
  const admin = await w.seedUser({
    email: 'root.admin@cgiar.org',
    nickname: 'Root',
    roles: [['ADMIN']],
    lastLoginAt: new Date('2026-10-01T00:00:00Z'),
  });
  const target = await w.seedUser({
    email: 'ana@cgiar.org',
    nickname: 'Ana',
    invitation: 'sent',
    roles: [['ASSESSOR', 'KP']],
    ...row.seed,
  });
  await row.prepare?.(w, target, admin.id);
  const ctx: AdminContext = { actorId: admin.id, requestId: 'req-1' };
  return { w, admin, target, ctx, key: 'key-1' };
}

/** A transaction whose commit fails after all the work, as a lost connection does: nothing it wrote may survive. */
class CommitFails implements UsersAdminUnitOfWork {
  constructor(private readonly db: InMemoryDatabase) {}
  async run<T>(work: (r: UsersAdminRepositories) => Promise<T>): Promise<T> {
    const tx = this.db.begin();
    try {
      await work(tx.repositories());
      throw new Error('connection lost before commit');
    } catch (error) {
      tx.rollback();
      throw error;
    }
  }
}

const serviceOver = (w: AdminWorld, unitOfWork: UsersAdminUnitOfWork) =>
  new UsersAdminService(
    unitOfWork,
    w.users,
    w.catalogs as unknown as CatalogService,
    w.cognito as unknown as CognitoAdminClient,
    w.cache as unknown as CurrentUserCache,
  );

async function failureOf(work: Promise<unknown>): Promise<HttpException> {
  try {
    await work;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to be refused, but it succeeded');
}

const codeOf = (error: HttpException) =>
  (error.getResponse() as { code: string }).code;

const keyRow = (w: AdminWorld, actorId: number, key = 'key-1') =>
  w.idempotency.peek(actorId, key)!;

describe('FR-2: the mark is written with the change, in the same transaction', () => {
  it.each(CHANGING)(
    '$name: a failed commit drops the change AND the mark; the commit that succeeds keeps both',
    async (row) => {
      const { w, ctx, target } = await arrange(row);
      const keyedCtx = await w.keyed(ctx);
      const before = w.snapshot();

      await expect(
        row.call(
          serviceOver(w, new CommitFails(w.db)),
          keyedCtx,
          target.id,
          w,
          0,
        ),
      ).rejects.toThrow('connection lost before commit');

      expect(w.snapshot()).toBe(before);
      expect(keyRow(w, ctx.actorId)).toMatchObject({
        state: 'in_progress',
        targetUserId: null,
      });
      expect(w.cache.invalidate).not.toHaveBeenCalled();

      const done = await row.call(w.service, keyedCtx, target.id, w, 0);

      expect(w.snapshot()).not.toBe(before);
      expect(w.db.audit.length).toBe(row.audits + auditsBefore(before));
      expect(keyRow(w, ctx.actorId)).toMatchObject({
        state: 'executed',
        targetUserId: done.userId,
      });
      expect(w.cache.invalidate).toHaveBeenCalledTimes(invalidations(row));
    },
  );

  it.each(NO_OPS)(
    '$name: nothing is written and the key is still marked executed',
    async (row) => {
      const { w, ctx, target } = await arrange(row);
      const keyedCtx = await w.keyed(ctx);
      const before = w.snapshot();

      const done = await row.call(w.service, keyedCtx, target.id, w, 0);

      expect(done).toMatchObject({ userId: target.id, changed: false });
      expect(w.snapshot()).toBe(before);
      expect(w.cache.invalidate).not.toHaveBeenCalled();
      expect(keyRow(w, ctx.actorId)).toMatchObject({
        state: 'executed',
        targetUserId: target.id,
      });
    },
  );

  it.each(CHANGING.filter((row) => row.byId !== false))(
    '$name: a refusal inside the transaction leaves the key in_progress, unmarked',
    async (row) => {
      const { w, ctx } = await arrange(row);
      const keyedCtx = await w.keyed(ctx);

      const error = await failureOf(row.call(w.service, keyedCtx, 9999, w, 0));

      expect(error.getStatus()).toBe(404);
      expect(keyRow(w, ctx.actorId)).toMatchObject({
        state: 'in_progress',
        targetUserId: null,
      });
    },
  );
});

/** A new user has no cached entry to drop; every other change drops its target's, once. */
const invalidations = (row: Row) => (row.byId === false ? 0 : 1);

/** Audit events already in the snapshot taken before the call. */
const auditsBefore = (snapshot: string) =>
  (JSON.parse(snapshot) as { audit: unknown[] }).audit.length;

describe('FR-5, NFR-1: a request that lost its key to a take-over cannot commit', () => {
  it.each(CHANGING)(
    '$name: the change rolls back, nothing is audited or invalidated, and the taker applies it once',
    async (row) => {
      const { w, ctx, target } = await arrange(row);
      const stalled = await w.keyed(ctx);
      let taker: AdminContext | undefined;
      // The stalled request is about to mark: its lease has run out and another
      // request has taken the key over and committed that take-over.
      w.unitOfWork.beforeMark = async () => {
        w.clock.advance(IDEMPOTENCY_LEASE_MS + 1_000);
        const reservation = await w.idempotency.takeOver(
          ctx.actorId,
          'key-1',
          stalled.idempotency!.reservation.ownerToken,
        );
        taker = {
          ...ctx,
          idempotency: { reservation: reservation!, outcome: 'taken_over' },
        };
      };
      const before = w.snapshot();

      const error = await failureOf(
        row.call(w.service, stalled, target.id, w, 0),
      );

      expect(error.getStatus()).toBe(409);
      expect(codeOf(error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(w.snapshot()).toBe(before);
      expect(w.cache.invalidate).not.toHaveBeenCalled();
      expect(keyRow(w, ctx.actorId)).toMatchObject({
        state: 'in_progress',
        ownerToken: taker!.idempotency!.reservation.ownerToken,
      });

      w.unitOfWork.beforeMark = undefined;
      await row.call(w.service, taker!, target.id, w, 0);

      expect(w.db.audit.length).toBe(row.audits + auditsBefore(before));
      expect(keyRow(w, ctx.actorId).state).toBe('executed');
      expect(w.cache.invalidate).toHaveBeenCalledTimes(invalidations(row));
    },
  );

  it('an executed key cannot be applied again: a second request on the same reservation rolls back, even a no-op', async () => {
    const { w, ctx, target } = await arrange(CHANGING[7]!);
    const keyedCtx = await w.keyed(ctx);
    await w.service.deactivate(keyedCtx, target.id);
    const afterFirst = w.snapshot();

    const error = await failureOf(w.service.deactivate(keyedCtx, target.id));

    expect(codeOf(error)).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(w.snapshot()).toBe(afterFirst);
    expect(w.cache.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('FR-1: without a reservation nothing is marked', () => {
  it.each(CHANGING)(
    '$name: behaves as before and leaves other keys alone',
    async (row) => {
      const { w, ctx, target } = await arrange(row);
      await w.keyed(ctx, 'someone-elses-key');
      const writes = w.idempotency.writes;
      const before = w.snapshot();

      await row.call(w.service, ctx, target.id, w, 0);

      expect(w.snapshot()).not.toBe(before);
      expect(w.idempotency.writes).toBe(writes);
      expect(keyRow(w, ctx.actorId, 'someone-elses-key').state).toBe(
        'in_progress',
      );
      expect(w.calls).not.toContain('mark');
    },
  );
});

describe('create and resendInvitation mark in the transaction that follows the Cognito call', () => {
  const custom: Row[] = [
    {
      name: 'create (custom account)',
      call: (s, ctx, _id, _w, n) =>
        s.create(ctx, { ...createCommand(n), accountType: 'custom' }),
      audits: 1,
      byId: false,
    },
    CHANGING[9]!,
  ];
  const cognitoCall = (row: Row) =>
    row.name.startsWith('create') ? 'cognito:createUser' : 'cognito:resend';

  it.each(custom)('$name: Cognito, then begin, mark, commit', async (row) => {
    const { w, ctx, target } = await arrange(row);
    const keyedCtx = await w.keyed(ctx);

    await row.call(w.service, keyedCtx, target.id, w, 0);

    const order = w.calls.filter((c) =>
      [cognitoCall(row), 'tx:begin', 'mark', 'tx:commit'].includes(c),
    );
    expect(order).toEqual([cognitoCall(row), 'tx:begin', 'mark', 'tx:commit']);
  });

  it.each(custom)(
    '$name: a take-over after Cognito answered still rolls the QA change back (the account may stay in the pool, DD-7)',
    async (row) => {
      const { w, ctx, target } = await arrange(row);
      const stalled = await w.keyed(ctx);
      w.unitOfWork.beforeMark = async () => {
        w.clock.advance(IDEMPOTENCY_LEASE_MS + 1_000);
        await w.idempotency.takeOver(
          ctx.actorId,
          'key-1',
          stalled.idempotency!.reservation.ownerToken,
        );
      };
      const before = w.snapshot();

      const error = await failureOf(
        row.call(w.service, stalled, target.id, w, 0),
      );

      expect(codeOf(error)).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(w.calls).toContain(cognitoCall(row));
      expect(w.snapshot()).toBe(before);
      expect(w.cache.invalidate).not.toHaveBeenCalled();
    },
  );
});

describe('the decision line reads the handle (design 7, Decision log)', () => {
  const lines = () =>
    infoLines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it.each([
    ['no handle', undefined, 'none'],
    ['a first execution', 'none', 'none'],
    ['a take-over', 'taken_over', 'taken_over'],
  ] as const)('%s writes idempotency=%s', async (_label, outcome, expected) => {
    const { w, ctx, target } = await arrange(CHANGING[1]!);
    const useCtx =
      outcome === undefined ? ctx : await w.keyed(ctx, 'key-1', outcome);

    await w.service.edit(useCtx, target.id, { nickname: 'Ana X' });

    expect(lines()).toEqual([
      {
        event: 'users_admin',
        action: 'edit',
        targetId: target.id,
        actorId: ctx.actorId,
        outcome: 'ok',
        requestId: 'req-1',
        idempotency: expected,
      },
    ]);
  });
});
