import { HttpException, Logger } from '@nestjs/common';
import {
  adminWorld,
  type AdminWorld,
} from '../../test/support/users-admin-world.js';
import { UpstreamUnavailableError as CatalogUnavailableError } from './catalogs/catalogs.errors.js';
import type {
  AdminContext,
  ReplaceUserCommand,
  UsersAdminService,
} from './users-admin.service.js';

// FR-8 (aggregate edit). Expected values are the spec's scenarios, written as
// literals: the aggregate and the sequence of separate calls must leave the
// same state and the same audit rows (parity), and a refusal at any step must
// leave no change, no audit row and no invalidation (all or nothing).

const infoLines: string[] = [];
beforeEach(() => {
  infoLines.length = 0;
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
      infoLines.push(String(message));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Scene {
  w: AdminWorld;
  ctx: AdminContext;
  target: { id: number };
}

/**
 * The same world every time: the acting admin (the only ADMIN), Bea (holds
 * the nickname "Bea"), and Ana (the target: never signed in, Assessor on KP,
 * all programs, no exclusions). Extra rows arrive through `prepare`.
 */
async function scene(
  opts: {
    targetSeed?: Partial<Parameters<AdminWorld['seedUser']>[0]>;
    targetIsAdmin?: boolean;
    prepare?: (s: Scene) => Promise<void>;
  } = {},
): Promise<Scene> {
  const w = adminWorld();
  const admin = await w.seedUser({
    email: 'root.admin@cgiar.org',
    nickname: 'Root',
    roles: [['ADMIN']],
    lastLoginAt: new Date('2026-10-01T00:00:00Z'),
  });
  await w.seedUser({ email: 'bea@cgiar.org', nickname: 'Bea' });
  const target = opts.targetIsAdmin
    ? admin
    : await w.seedUser({
        email: 'ana@cgiar.org',
        nickname: 'Ana',
        firstName: 'Ana',
        lastName: 'Diaz',
        invitation: 'sent',
        roles: [['ASSESSOR', 'KP']],
        ...opts.targetSeed,
      });
  const s: Scene = {
    w,
    ctx: { actorId: admin.id, requestId: 'req-1' },
    target,
  };
  await opts.prepare?.(s);
  return s;
}

const manualExclusion = (programId: number, reason: string) => (s: Scene) =>
  s.w.programs
    .addManualExclusion({
      userId: s.target.id,
      programId,
      reason,
      createdBy: s.ctx.actorId,
    })
    .then(() => undefined);

const reportingExclusion = (programId: number) => (s: Scene) =>
  s.w.db.stores.programs
    .insertExclusion({
      userId: s.target.id,
      programId,
      origin: 'reporting',
      reportingRole: 'Lead',
      createdBy: null,
    })
    .then(() => undefined);

/** The current state of Ana, sent back unchanged. */
const SAME: ReplaceUserCommand = {
  roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }],
  programs: 'all',
  exclusions: [],
};

/** What the API could show of one person, without clocks: the final state parity compares. */
function stateOf({ w, target }: Scene) {
  const user = w.db.users.find((u) => u.id === target.id)!;
  return {
    user: {
      email: user.email,
      nickname: user.nickname,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      invitation: user.invitation,
    },
    grants: w.db.assignments
      .filter((a) => a.userId === target.id && a.isActive)
      .map(
        (a) =>
          `${w.db.roles.find((r) => r.id === a.roleId)!.code}:${a.resultTypeKey ?? ''}`,
      )
      .sort(),
    scope: w.db.scope.filter((p) => p.userId === target.id),
    exclusions: w.db.exclusions
      .filter((e) => e.userId === target.id)
      .map(({ id, programId, origin, status, reason, endedBy }) => ({
        id,
        programId,
        origin,
        status,
        reason,
        endedBy,
      })),
  };
}

const auditOf = (w: AdminWorld) =>
  w.db.audit.map(({ action, userId, actorId, changes, requestId }) => ({
    action,
    userId,
    actorId,
    changes,
    requestId,
  }));

async function failureOf(work: Promise<unknown>): Promise<HttpException> {
  try {
    await work;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to be refused, but it succeeded');
}

const bodyOf = (error: HttpException) =>
  error.getResponse() as {
    code: string;
    fields?: Array<{ field: string; code: string }>;
  };

// ---------------------------------------------------------------------------
// Parity: the aggregate vs the sequence of separate calls
// ---------------------------------------------------------------------------

interface ParityRow {
  name: string;
  setup?: Parameters<typeof scene>[0];
  body: ReplaceUserCommand;
  /** The separate routes, called one after the other, for the same change. */
  separate: (
    s: UsersAdminService,
    ctx: AdminContext,
    id: number,
    w: AdminWorld,
  ) => Promise<unknown>;
  /** The audit actions of the change, in order (core DD-15); empty = nothing changed. */
  audits: string[];
}

const PARITY: ParityRow[] = [
  {
    name: 'full save: nickname, roles, programs and a new exclusion',
    body: {
      nickname: 'Ana B',
      roles: [{ role: 'ASSESSOR', resultTypes: ['POLICY'] }],
      programs: [1, 2],
      exclusions: [{ programId: 3, reason: 'Co-author' }],
    },
    separate: async (s, ctx, id) => {
      await s.edit(ctx, id, { nickname: 'Ana B' });
      await s.replaceRoles(ctx, id, [
        { role: 'ASSESSOR', resultTypes: ['POLICY'] },
      ]);
      await s.replacePrograms(ctx, id, [1, 2]);
      await s.addExclusion(ctx, id, { programId: 3, reason: 'Co-author' });
    },
    audits: [
      'update',
      'role_revoke',
      'role_grant',
      'scope_change',
      'exclusion_add',
    ],
  },
  {
    name: 'first and last name of a user who never signed in',
    body: { ...SAME, firstName: 'Anita', lastName: 'Diaz Ruiz' },
    separate: (s, ctx, id) =>
      s.edit(ctx, id, { firstName: 'Anita', lastName: 'Diaz Ruiz' }),
    audits: ['update'],
  },
  {
    name: 'Assessor KP becomes Lead Assessor KP (revoke before insert)',
    body: { ...SAME, roles: [{ role: 'LEAD_ASSESSOR', resultTypes: ['KP'] }] },
    separate: (s, ctx, id) =>
      s.replaceRoles(ctx, id, [{ role: 'LEAD_ASSESSOR', resultTypes: ['KP'] }]),
    audits: ['role_revoke', 'role_grant'],
  },
  {
    name: 'exclusion removed: a manual one that the list no longer names',
    setup: { prepare: manualExclusion(1, 'Co-author') },
    body: SAME,
    separate: (s, ctx, id, w) =>
      s.removeExclusion(ctx, id, w.db.exclusions[0]!.id),
    audits: ['exclusion_remove'],
  },
  {
    name: 'exclusions reconciled: one kept, one added, one removed',
    setup: {
      prepare: async (s) => {
        await manualExclusion(1, 'Old one')(s);
        await manualExclusion(2, 'Kept one')(s);
      },
    },
    body: {
      ...SAME,
      exclusions: [
        { programId: 2, reason: 'Kept one' },
        { programId: 3, reason: 'New one' },
      ],
    },
    separate: async (s, ctx, id, w) => {
      await s.addExclusion(ctx, id, { programId: 3, reason: 'New one' });
      await s.removeExclusion(ctx, id, w.db.exclusions[0]!.id);
    },
    audits: ['exclusion_add', 'exclusion_remove'],
  },
  {
    name: 'an existing manual exclusion keeps its original reason when the list sends another',
    setup: { prepare: manualExclusion(1, 'Original reason') },
    body: { ...SAME, exclusions: [{ programId: 1, reason: 'A new reason' }] },
    separate: async () => undefined,
    audits: [],
  },
  {
    name: 'reporting exclusions are never removed by the aggregate',
    setup: { prepare: reportingExclusion(3) },
    body: { ...SAME, nickname: 'Ana C' },
    separate: (s, ctx, id) => s.edit(ctx, id, { nickname: 'Ana C' }),
    audits: ['update'],
  },
  {
    name: 'no change: the sent state equals the current state',
    setup: { prepare: manualExclusion(1, 'Co-author') },
    body: {
      nickname: 'Ana',
      firstName: 'Ana',
      lastName: 'Diaz',
      ...SAME,
      exclusions: [{ programId: 1, reason: 'Co-author' }],
    },
    separate: async () => undefined,
    audits: [],
  },
];

describe('replaceUser parity with the separate routes (FR-8)', () => {
  it.each(PARITY)('$name', async (row) => {
    const sep = await scene(row.setup);
    await row.separate(sep.w.service, sep.ctx, sep.target.id, sep.w);

    const agg = await scene(row.setup);
    const result = await agg.w.service.replaceUser(
      agg.ctx,
      agg.target.id,
      row.body,
    );

    // Same final state, same audit rows (ids and values included).
    expect(stateOf(agg)).toEqual(stateOf(sep));
    expect(auditOf(agg.w)).toEqual(auditOf(sep.w));
    // The audit rows of the change itself, as the spec states them.
    const changeAudits = auditOf(agg.w).filter(
      (e) => e.userId === agg.target.id,
    );
    expect(changeAudits.map((e) => e.action)).toEqual(row.audits);
    // Unchanged parts write nothing; a change invalidates the target once.
    expect(result).toEqual({
      userId: agg.target.id,
      changed: row.audits.length > 0,
    });
    expect(agg.w.cache.invalidate.mock.calls).toEqual(
      row.audits.length > 0 ? [[agg.target.id]] : [],
    );
  });

  it('writes the same decision-log line shape as the other mutations, with action replace', async () => {
    const { w, ctx, target } = await scene();

    await w.service.replaceUser(ctx, target.id, SAME);

    expect(infoLines.map((l) => JSON.parse(l))).toEqual([
      {
        event: 'users_admin',
        action: 'replace',
        targetId: target.id,
        actorId: ctx.actorId,
        outcome: 'ok',
        requestId: 'req-1',
        idempotency: 'none',
      },
    ]);
  });

  it('a full save leaves reporting exclusions, activation, invitation and email untouched, and asks each catalog once', async () => {
    const s = await scene({
      targetSeed: { isActive: false },
      prepare: reportingExclusion(3),
    });
    const before = stateOf(s);

    await s.w.service.replaceUser(s.ctx, s.target.id, {
      nickname: 'Ana D',
      roles: [{ role: 'ASSESSOR', resultTypes: ['POLICY'] }],
      programs: [1],
      exclusions: [{ programId: 2, reason: 'Co-author' }],
    });

    const after = stateOf(s);
    expect(after.user).toEqual({ ...before.user, nickname: 'Ana D' });
    expect(after.user).toMatchObject({
      email: 'ana@cgiar.org',
      isActive: false,
      invitation: 'sent',
    });
    expect(after.exclusions[0]).toEqual(before.exclusions[0]);
    expect(after.exclusions[0]).toMatchObject({
      programId: 3,
      origin: 'reporting',
      status: 'active',
    });
    expect(s.w.catalogs.listResultTypes).toHaveBeenCalledTimes(1);
    expect(s.w.catalogs.listSciencePrograms).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// All or nothing: a refusal at each step
// ---------------------------------------------------------------------------

/** Changes every part that can run before the refusal, so a partial apply would be visible. */
const WRITES_EVERYTHING: ReplaceUserCommand = {
  nickname: 'Ana Z',
  roles: [{ role: 'ASSESSOR', resultTypes: ['POLICY'] }],
  programs: [1, 2],
  exclusions: [{ programId: 3, reason: 'Co-author' }],
};

interface RefusalRow {
  name: string;
  setup?: Parameters<typeof scene>[0];
  body: ReplaceUserCommand;
  arrange?: (w: AdminWorld) => void;
  status: number;
  code: string;
  fields?: Array<{ field: string; code: string }>;
}

const REFUSALS: RefusalRow[] = [
  {
    name: 'nickname taken',
    body: { ...WRITES_EVERYTHING, nickname: 'Bea' },
    status: 409,
    code: 'USERS_NICKNAME_TAKEN',
  },
  {
    name: 'name locked: the user has signed in',
    setup: { targetSeed: { lastLoginAt: new Date('2026-09-01T00:00:00Z') } },
    body: { ...WRITES_EVERYTHING, firstName: 'Anita' },
    status: 409,
    code: 'USERS_NAME_LOCKED',
  },
  {
    name: 'role conflict: Assessor on all with Lead Assessor on KP',
    body: {
      ...WRITES_EVERYTHING,
      roles: [
        { role: 'ASSESSOR', resultTypes: 'all' },
        { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
      ],
    },
    status: 409,
    code: 'USERS_ROLE_CONFLICT',
  },
  {
    name: 'last admin: the nickname change comes before the refused role removal',
    setup: { targetIsAdmin: true },
    body: { nickname: 'Root B', roles: [], programs: 'all', exclusions: [] },
    status: 409,
    code: 'USERS_LAST_ADMIN',
  },
  {
    name: 'unknown program in the scope',
    body: { ...WRITES_EVERYTHING, programs: [1, 99] },
    status: 400,
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'programs', code: 'INVALID' }],
  },
  {
    name: 'unknown program in an exclusion',
    body: {
      ...WRITES_EVERYTHING,
      exclusions: [{ programId: 99, reason: 'Co-author' }],
    },
    status: 400,
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'exclusions[0].programId', code: 'INVALID' }],
  },
  {
    name: 'unknown result type',
    body: {
      ...WRITES_EVERYTHING,
      roles: [{ role: 'ASSESSOR', resultTypes: ['NOPE'] }],
    },
    status: 400,
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
  },
  {
    name: 'a program listed twice in the exclusions',
    body: {
      ...WRITES_EVERYTHING,
      exclusions: [
        { programId: 3, reason: 'One' },
        { programId: 3, reason: 'Two' },
      ],
    },
    status: 400,
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'exclusions[1].programId', code: 'INVALID' }],
  },
  {
    name: 'an empty program list (use "all")',
    body: { ...WRITES_EVERYTHING, programs: [] },
    status: 400,
    code: 'VALIDATION_FAILED',
    fields: [{ field: 'programs', code: 'INVALID' }],
  },
  {
    name: 'catalog unavailable (503)',
    body: WRITES_EVERYTHING,
    arrange: (w) => {
      w.catalogs.listSciencePrograms.mockRejectedValue(
        new CatalogUnavailableError(),
      );
    },
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
  },
  {
    name: 'a reporting exclusion is active on a listed program, after every other part wrote',
    setup: { prepare: reportingExclusion(3) },
    body: WRITES_EVERYTHING,
    status: 409,
    code: 'USERS_EXCLUSION_EXISTS',
  },
];

describe('replaceUser is all or nothing (FR-8)', () => {
  it.each(REFUSALS)(
    '$name: refused, no change, no audit, no invalidation',
    async (row) => {
      const { w, ctx, target } = await scene(row.setup);
      row.arrange?.(w);
      const before = w.snapshot();
      const auditBefore = w.db.audit.length;

      const error = await failureOf(
        w.service.replaceUser(ctx, target.id, row.body),
      );

      expect(error.getStatus()).toBe(row.status);
      expect(bodyOf(error).code).toBe(row.code);
      if (row.fields) {
        expect(
          bodyOf(error).fields!.map(({ field, code }) => ({ field, code })),
        ).toEqual(row.fields);
      }
      expect(w.snapshot()).toBe(before);
      expect(w.db.audit.length).toBe(auditBefore);
      expect(w.cache.invalidate).not.toHaveBeenCalled();
    },
  );

  it('last admin refusal leaves the nickname unchanged (the roles step cannot commit on its own)', async () => {
    const { w, ctx, target } = await scene({ targetIsAdmin: true });

    await failureOf(
      w.service.replaceUser(ctx, target.id, {
        nickname: 'Root B',
        roles: [],
        programs: 'all',
        exclusions: [],
      }),
    );

    expect(w.db.users.find((u) => u.id === target.id)!.nickname).toBe('Root');
  });

  it('unknown user: 404 USERS_NOT_FOUND and nothing is written', async () => {
    const { w, ctx } = await scene();
    const before = w.snapshot();

    const error = await failureOf(
      w.service.replaceUser(ctx, 9999, WRITES_EVERYTHING),
    );

    expect(error.getStatus()).toBe(404);
    expect(bodyOf(error).code).toBe('USERS_NOT_FOUND');
    expect(w.snapshot()).toBe(before);
    expect(w.cache.invalidate).not.toHaveBeenCalled();
  });
});
