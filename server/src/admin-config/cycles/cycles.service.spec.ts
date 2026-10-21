import { Logger } from '@nestjs/common';
import {
  InMemoryAdminConfigDatabase,
  InMemoryCyclesUnitOfWork,
} from '../../../test/support/in-memory-admin-config.js';
import {
  FakeClock,
  roundTrip,
} from '../../../test/support/in-memory-idempotency.js';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import type { TimelineStep } from '../../database/drizzle/schema/timeline-steps.js';
import type { Timeline } from '../../database/drizzle/schema/timelines.js';
import { FieldValidationError } from '../../users/users.errors.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import {
  CycleNotDraftError,
  CycleNotFoundError,
  CycleYearTakenError,
} from '../admin-config.errors.js';
import { CyclesService } from './cycles.service.js';

// Expected values come from FR-1 (new cycle, duplicate year, invalid year),
// FR-2 (list), FR-3 (switch, not a draft), NFR-3 (the database keys hold under
// concurrency), NFR-7 (one decision line per write) and design 7.3, written
// out as literals. The fakes model row locks and a round trip per statement,
// so the concurrent cases interleave like two connections do.

const NOW = new Date('2026-10-20T10:00:00.000Z');
const SEEDED_AT = new Date('2025-02-01T00:00:00.000Z');

function world() {
  const clock = new FakeClock(NOW);
  const db = new InMemoryAdminConfigDatabase();
  const unitOfWork = new InMemoryCyclesUnitOfWork(db);
  const service = new CyclesService(unitOfWork, db.store, clock.now);
  const ctx = (actorId = 7): AdminConfigContext => ({
    actorId,
    requestId: 'req-1',
  });

  /** A committed cycle, written outside any request: `draft`, `active`, or `closed` (activated, then closed). */
  const seed = async (
    year: number,
    status: 'draft' | 'active' | 'closed' = 'draft',
  ) => {
    const created = await db.store.insert({
      year,
      status: 'draft',
      createdAt: SEEDED_AT,
      createdBy: 1,
    });
    if (created.kind !== 'created') throw new Error('seed: year taken');
    const { id } = created.cycle;
    if (status !== 'draft') {
      await db.store.markActive(id, { by: 1, at: SEEDED_AT });
    }
    if (status === 'closed') {
      await db.store.markClosed(id, { by: 1, at: SEEDED_AT });
    }
    db.writeLog.length = 0;
    return id;
  };
  const activeCount = () =>
    db.cycles.filter((c) => c.status === 'active').length;
  return { clock, db, unitOfWork, service, ctx, seed, activeCount };
}

/** The error a promise rejects with. */
async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, got a result');
}

describe('create (FR-1)', () => {
  it('creates a draft with the display name, who created it and when', async () => {
    const { service, ctx, db } = world();

    const result = await service.create(ctx(7), { year: 2027 });

    expect(result).toEqual({ cycleId: 1 });
    expect(db.cycles).toHaveLength(1);
    expect(db.cycles[0]).toMatchObject({
      id: 1,
      year: 2027,
      status: 'draft',
      activeKey: null,
      createdBy: 7,
      createdAt: NOW,
      activatedAt: null,
      activatedBy: null,
      closedAt: null,
      closedBy: null,
    });
    expect(await service.get(1)).toEqual({
      id: 1,
      year: 2027,
      name: '2027 cycle',
      status: 'draft',
      timelineCount: 0,
      startsOn: null,
      endsOn: null,
      createdAt: NOW,
    });
  });

  it('never becomes active by being created, and leaves the active cycle alone', async () => {
    const { service, ctx, db, seed } = world();
    await seed(2026, 'active');

    await service.create(ctx(), { year: 2027 });

    expect(db.cycles.map((c) => [c.year, c.status])).toEqual([
      [2026, 'active'],
      [2027, 'draft'],
    ]);
  });

  it.each([2020, 2100])('accepts the boundary year %i', async (year) => {
    const { service, ctx, db } = world();

    await service.create(ctx(), { year });

    expect(db.cycles.map((c) => c.year)).toEqual([year]);
  });

  it('refuses a second cycle for the same year with 409 CYCLES_YEAR_TAKEN and writes nothing', async () => {
    const { service, ctx, db, seed, unitOfWork } = world();
    await seed(2026, 'active');
    const before = JSON.stringify(db.cycles);

    const error = await refusal(service.create(ctx(), { year: 2026 }));

    expect(error).toBeInstanceOf(CycleYearTakenError);
    expect((error as CycleYearTakenError).getStatus()).toBe(409);
    expect((error as CycleYearTakenError).getResponse()).toMatchObject({
      code: 'CYCLES_YEAR_TAKEN',
    });
    expect(JSON.stringify(db.cycles)).toBe(before);
    expect(unitOfWork.rolledBack).toBe(1);
  });

  it('two creates of one year at the same time: one cycle is created, the other is refused', async () => {
    const { service, ctx, db, unitOfWork } = world();

    const settled = await Promise.allSettled([
      service.create(ctx(7), { year: 2026 }),
      service.create(ctx(8), { year: 2026 }),
    ]);

    expect(settled.map((s) => s.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = settled.find((s) => s.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      CycleYearTakenError,
    );
    expect(db.cycles.filter((c) => c.year === 2026)).toHaveLength(1);
    expect(unitOfWork.committed).toBe(1);
    expect(unitOfWork.rolledBack).toBe(1);
  });

  it.each<[unknown, string]>([
    [2019, 'OUT_OF_RANGE'],
    [2101, 'OUT_OF_RANGE'],
    [0, 'OUT_OF_RANGE'],
    ['2026', 'INVALID_TYPE'],
    [2026.5, 'INVALID_TYPE'],
    [Number.NaN, 'INVALID_TYPE'],
    [undefined, 'REQUIRED'],
    [null, 'REQUIRED'],
  ])(
    'refuses the year %j with 400 on `year` (%s) before any transaction opens',
    async (year, code) => {
      const { service, ctx, db, unitOfWork } = world();

      const error = await refusal(service.create(ctx(), { year }));

      expect(error).toBeInstanceOf(FieldValidationError);
      expect((error as FieldValidationError).getStatus()).toBe(400);
      expect((error as FieldValidationError).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'year', code }],
      });
      expect(db.cycles).toHaveLength(0);
      expect(unitOfWork.begun).toBe(0);
    },
  );
});

describe('activate (FR-3)', () => {
  it('makes the draft active and closes the previous one in one transaction, closing first', async () => {
    const { service, ctx, db, seed, unitOfWork } = world();
    const old = await seed(2026, 'active');
    const next = await seed(2027);

    const result = await service.activate(ctx(9), next);

    expect(result).toEqual({ cycleId: next });
    const [closed, active] = [
      db.cycles.find((c) => c.id === old)!,
      db.cycles.find((c) => c.id === next)!,
    ];
    expect(closed).toMatchObject({
      status: 'closed',
      activeKey: null,
      closedAt: NOW,
      closedBy: 9,
      // It keeps its own activation data.
      activatedAt: SEEDED_AT,
      activatedBy: 1,
    });
    expect(active).toMatchObject({
      status: 'active',
      activeKey: 1,
      activatedAt: NOW,
      activatedBy: 9,
      closedAt: null,
      closedBy: null,
    });
    expect(unitOfWork).toMatchObject({ begun: 1, committed: 1, rolledBack: 0 });
    expect(db.writeLog).toEqual([`close:${old}`, `activate:${next}`]);
  });

  it('activates the draft when no cycle is active', async () => {
    const { service, ctx, db, seed } = world();
    const id = await seed(2027);

    await service.activate(ctx(), id);

    expect(db.cycles.map((c) => c.status)).toEqual(['active']);
    expect(db.writeLog).toEqual([`activate:${id}`]);
  });

  it('leaves the other drafts and the closed cycles alone', async () => {
    const { service, ctx, db, seed } = world();
    await seed(2025, 'closed');
    await seed(2026, 'active');
    const next = await seed(2027);
    await seed(2028);

    await service.activate(ctx(), next);

    expect(db.cycles.map((c) => [c.year, c.status])).toEqual([
      [2025, 'closed'],
      [2026, 'closed'],
      [2027, 'active'],
      [2028, 'draft'],
    ]);
  });

  it.each(['active', 'closed'] as const)(
    'refuses a %s cycle with 409 CYCLES_NOT_DRAFT and changes nothing',
    async (status) => {
      const { service, ctx, db, seed, unitOfWork } = world();
      const closedOne = status === 'closed' ? await seed(2025, 'closed') : 0;
      const activeOne = await seed(2026, 'active');
      const target = status === 'closed' ? closedOne : activeOne;
      const before = JSON.stringify(db.cycles);

      const error = await refusal(service.activate(ctx(), target));

      expect(error).toBeInstanceOf(CycleNotDraftError);
      expect((error as CycleNotDraftError).getStatus()).toBe(409);
      expect((error as CycleNotDraftError).getResponse()).toMatchObject({
        code: 'CYCLES_NOT_DRAFT',
      });
      expect(JSON.stringify(db.cycles)).toBe(before);
      expect(db.writeLog).toEqual([]);
      expect(unitOfWork.rolledBack).toBe(1);
    },
  );

  it('answers 404 CYCLES_NOT_FOUND for an unknown cycle', async () => {
    const { service, ctx, seed } = world();
    await seed(2026, 'active');

    const error = await refusal(service.activate(ctx(), 999));

    expect(error).toBeInstanceOf(CycleNotFoundError);
    expect((error as CycleNotFoundError).getStatus()).toBe(404);
  });

  it('two activations at once never leave two active cycles, or none, to a reader', async () => {
    const { service, ctx, db, seed, activeCount } = world();
    await seed(2026, 'active');
    const second = await seed(2027);
    const third = await seed(2028);

    // A reader that looks at the committed rows between every statement.
    const samples: number[] = [];
    let running = true;
    const reader = (async () => {
      while (running) {
        samples.push(activeCount());
        await roundTrip();
      }
    })();
    const settled = await Promise.allSettled([
      service.activate(ctx(7), second),
      service.activate(ctx(8), third),
    ]);
    running = false;
    await reader;

    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    // The reader really looked while the two transactions were in flight.
    expect(samples.length).toBeGreaterThan(6);
    expect([...new Set(samples)]).toEqual([1]);
    expect(activeCount()).toBe(1);
    expect(db.cycles.filter((c) => c.status === 'closed')).toHaveLength(2);
  });

  it('two activations of the same draft: one wins, the other is refused as not a draft', async () => {
    const { service, ctx, db, seed } = world();
    await seed(2026, 'active');
    const target = await seed(2027);

    const settled = await Promise.allSettled([
      service.activate(ctx(7), target),
      service.activate(ctx(8), target),
    ]);

    expect(settled.map((s) => s.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = settled.find((s) => s.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      CycleNotDraftError,
    );
    expect(db.cycles.map((c) => [c.year, c.status])).toEqual([
      [2026, 'closed'],
      [2027, 'active'],
    ]);
  });

  it('two activations from "none active" are not serialized by a lock: the unique key refuses the second, which retries and closes the first', async () => {
    const { service, ctx, db, seed, unitOfWork, activeCount } = world();
    await seed(2027);
    await seed(2028);

    const samples: number[] = [];
    let running = true;
    const reader = (async () => {
      while (running) {
        samples.push(activeCount());
        await roundTrip();
      }
    })();
    const settled = await Promise.allSettled([
      service.activate(ctx(7), 1),
      service.activate(ctx(8), 2),
    ]);
    running = false;
    await reader;

    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Math.max(...samples)).toBe(1);
    expect(activeCount()).toBe(1);
    expect(db.cycles.filter((c) => c.status === 'closed')).toHaveLength(1);
    // Three transactions: the first, the second (refused by `uq_cycles_active_key`, rolled back) and its retry.
    expect(unitOfWork).toMatchObject({ begun: 3, committed: 2, rolledBack: 1 });
  });

  it('the fake database refuses a second active row (1062): the backstop the lock order never reaches', async () => {
    const { db, seed } = world();
    await seed(2026, 'active');
    const draft = await seed(2027);

    const error = await refusal(db.store.markActive(draft, { by: 1, at: NOW }));

    expect(error).toMatchObject({ code: 'ER_DUP_ENTRY', errno: 1062 });
    expect(db.cycles.filter((c) => c.status === 'active')).toHaveLength(1);
  });
});

describe('list and detail (FR-2, design 7.4)', () => {
  const timeline = (id: number, cycleId: number): Timeline => ({
    id,
    cycleId,
    name: `Timeline ${id}`,
    kind: id === 1 ? 'official' : 'additional',
    officialKey: id === 1 ? cycleId : null,
    allPrograms: true,
    allResultTypes: true,
    createdAt: SEEDED_AT,
    createdBy: 1,
  });
  const step = (
    id: number,
    timelineId: number,
    opensOn: string,
    closesOn: string,
  ) =>
    ({
      id,
      timelineId,
      position: id,
      name: `Step ${id}`,
      audience: 'assessors',
      opensOn,
      closesOn,
      round: 1,
      requiresLoad: id === 1,
    }) as TimelineStep;

  async function seeded() {
    const w = world();
    // 2027 closed (ids go in creation order), 2026 active, 2028 draft.
    const id2027 = await w.seed(2027, 'closed');
    const id2026 = await w.seed(2026, 'active');
    const id2028 = await w.seed(2028);
    w.db.timelines.push(
      timeline(1, id2026),
      timeline(2, id2026),
      timeline(3, id2027),
    );
    w.db.steps.push(
      step(1, 1, '2026-07-06', '2026-07-20'),
      step(2, 1, '2026-07-21', '2026-08-05'),
      step(3, 2, '2026-06-15', '2026-06-30'),
    );
    return { ...w, id2026, id2027, id2028 };
  }

  it('lists the newest year first with the timeline count and the date range of the steps', async () => {
    const { service } = await seeded();

    const list = await service.list();

    expect(
      list.map((c) => [
        c.year,
        c.name,
        c.status,
        c.timelineCount,
        c.startsOn,
        c.endsOn,
      ]),
    ).toEqual([
      [2028, '2028 cycle', 'draft', 0, null, null],
      // One timeline without steps: it counts, and covers no dates.
      [2027, '2027 cycle', 'closed', 1, null, null],
      // Two timelines: earliest opening 15 Jun, latest closing 5 Aug.
      [2026, '2026 cycle', 'active', 2, '2026-06-15', '2026-08-05'],
    ]);
  });

  it('answers the same read model for one cycle, and 404 CYCLES_NOT_FOUND for an unknown one', async () => {
    const { service, id2026 } = await seeded();

    expect(await service.get(id2026)).toMatchObject({
      year: 2026,
      timelineCount: 2,
      startsOn: '2026-06-15',
      endsOn: '2026-08-05',
    });
    expect(await refusal(service.get(999))).toBeInstanceOf(CycleNotFoundError);
  });

  it('is one store call whatever the number of cycles (no per-cycle query)', async () => {
    const { service, db } = await seeded();
    const before = db.store.queries;

    await service.list();

    expect(db.store.queries - before).toBe(1);
    const one = world();
    await one.seed(2026);
    await one.service.list();
    expect(one.db.store.queries).toBe(1);
  });
});

describe('the idempotency fence (FR-17, P-1)', () => {
  async function keyed(w: ReturnType<typeof world>, key = 'key-1') {
    const store = w.db.base.idempotencyStore(w.clock.now);
    const reserved = await store.reserve({
      actorId: 7,
      key,
      fingerprint: 'f'.repeat(64),
      routeStatus: 201,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');
    const ctx: AdminConfigContext = {
      actorId: 7,
      requestId: 'req-1',
      idempotency: { reservation: reserved.reservation, outcome: 'none' },
    };
    return { store, ctx };
  }

  it('marks the key executed in the same transaction as the cycle, with the cycle id as the target', async () => {
    const w = world();
    const { store, ctx } = await keyed(w);

    await w.service.create(ctx, { year: 2027 });

    expect(store.peek(7, 'key-1')).toMatchObject({
      state: 'executed',
      targetUserId: 1,
    });
    expect(w.db.cycles).toHaveLength(1);
  });

  it('a refused create does not mark the key', async () => {
    const w = world();
    await w.seed(2027);
    const { store, ctx } = await keyed(w);

    await refusal(w.service.create(ctx, { year: 2027 }));

    expect(store.peek(7, 'key-1')).toMatchObject({ state: 'in_progress' });
  });

  it('a request that lost its key to a take-over rolls the cycle back', async () => {
    const w = world();
    const { store, ctx } = await keyed(w);
    // Another request took the key over: the owner token is no longer ours.
    store.seed({ ...store.peek(7, 'key-1')!, ownerToken: 'someone-else' });

    const error = await refusal(w.service.create(ctx, { year: 2027 }));

    expect(error).toBeInstanceOf(IdempotencyFenceLostError);
    expect(w.db.cycles).toHaveLength(0);
    expect(w.unitOfWork.rolledBack).toBe(1);
  });
});

describe('the decision line (NFR-7)', () => {
  const lines: Array<{ level: string; line: Record<string, unknown> }> = [];

  beforeEach(() => {
    lines.length = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message) => {
        lines.push({
          level,
          line: JSON.parse(String(message)) as Record<string, unknown>,
        });
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    event: 'admin_config',
    actorId: 7,
    requestId: 'req-1',
    idempotency: 'none',
  };

  it('a create writes one line with ids and fixed words, and never the year', async () => {
    const { service, ctx } = world();

    await service.create(ctx(7), { year: 2027 });

    expect(lines).toEqual([
      {
        level: 'log',
        line: { ...base, action: 'cycle_create', targetId: 1, outcome: 'ok' },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('2027');
  });

  it('a refused create writes one warn line with the catalog code as the reason', async () => {
    const { service, ctx, seed } = world();
    await seed(2026);

    await refusal(service.create(ctx(7), { year: 2026 }));

    expect(lines).toEqual([
      {
        level: 'warn',
        line: {
          ...base,
          action: 'cycle_create',
          targetId: null,
          outcome: 'refused',
          reason: 'CYCLES_YEAR_TAKEN',
        },
      },
    ]);
  });

  it('an invalid year is refused with the reason VALIDATION_FAILED', async () => {
    const { service, ctx } = world();

    await refusal(service.create(ctx(7), { year: 1999 }));

    expect(lines.map((l) => l.line.reason)).toEqual(['VALIDATION_FAILED']);
  });

  it('an activation writes one line, whatever the retries behind it', async () => {
    const { service, ctx, seed } = world();
    await seed(2027);
    await seed(2028);

    await Promise.all([
      service.activate(ctx(7), 1),
      service.activate(ctx(7), 2),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.line)).toEqual([
      { ...base, action: 'cycle_activate', targetId: 1, outcome: 'ok' },
      { ...base, action: 'cycle_activate', targetId: 2, outcome: 'ok' },
    ]);
  });

  it.each([
    [999, 'CYCLES_NOT_FOUND'],
    [1, 'CYCLES_NOT_DRAFT'],
  ])('refusing to activate cycle %i logs the reason %s', async (id, reason) => {
    const { service, ctx, seed } = world();
    await seed(2026, 'active');

    await refusal(service.activate(ctx(7), id));

    expect(lines).toEqual([
      {
        level: 'warn',
        line: {
          ...base,
          action: 'cycle_activate',
          targetId: id,
          outcome: 'refused',
          reason,
        },
      },
    ]);
  });

  it('reads write no line', async () => {
    const { service, seed } = world();
    await seed(2026);

    await service.list();
    await service.get(1);

    expect(lines).toEqual([]);
  });
});
