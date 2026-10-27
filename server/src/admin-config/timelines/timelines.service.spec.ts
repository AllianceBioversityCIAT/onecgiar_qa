import { Logger } from '@nestjs/common';
import {
  InMemoryAdminConfigDatabase,
  InMemoryCyclesUnitOfWork,
  InMemoryTimelinesUnitOfWork,
} from '../../../test/support/in-memory-admin-config.js';
import {
  FakeClock,
  roundTrip,
} from '../../../test/support/in-memory-idempotency.js';
import { IdempotencyFenceLostError } from '../../common/idempotency/idempotency.errors.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import { UserNotFoundError } from '../../users/users.errors.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import {
  CycleClosedError,
  CycleNotFoundError,
  TimelineAssignmentNotFoundError,
  TimelineInProgressUnconfirmedError,
  TimelineNameTakenError,
  TimelineNotFoundError,
  TimelineUserNotEligibleError,
  TimelineValidationError,
  TimelineVersionStaleError,
} from '../admin-config.errors.js';
import { CyclesService } from '../cycles/cycles.service.js';
import type { TimelineUser } from '../../database/drizzle/schema/timeline-users.js';
import type { RomeMinute } from '../rome-date.js';
import { NoTimelineLoads, type TimelineLoads } from './timeline-loads.js';
import {
  TimelinesService,
  type AssignResult,
  type AssignUserCommand,
  type CreateTimelineCommand,
  type UpdateTimelineCommand,
} from './timelines.service.js';
import type { TimelinesStore } from './timelines.store.js';
import type { TimelinesUnitOfWork } from './timelines.unit-of-work.js';

// Expected values come from FR-4 (default steps), FR-5 (official or additional,
// two at once, closed or unknown cycle), FR-6 (name, scope, catalog down),
// FR-11 (every problem at once, nothing written), FR-17 (the key fence),
// NFR-3 (the database keys hold under concurrency), NFR-7 (one decision line)
// and design 7.2 / 7.3, written out as literals. The fakes model row locks and a
// round trip per statement, so the concurrent cases interleave like two
// connections do, and the catalog sources can fail like an unreachable one.

const NOW = new Date('2026-10-20T10:00:00.000Z'); // 2026-10-20 in Rome
const SEEDED_AT = new Date('2025-02-01T00:00:00.000Z');

const PROGRAMS = [
  { id: 1, code: 'SP01', name: 'Breeding' },
  { id: 2, code: 'SP02', name: 'Multifunctional landscapes' },
  { id: 3, code: 'SP03', name: 'Climate action' },
];
const RESULT_TYPES = [
  { key: 'KP', name: 'Knowledge product' },
  { key: 'INNOVATION_DEV', name: 'Innovation development' },
  { key: 'POLICY', name: 'Policy change' },
];

const STEP_1 = {
  name: 'QA Platform open for assessors',
  audience: 'assessors',
  opensOn: '2026-11-02',
  closesOn: '2026-11-06',
  round: 1,
  requiresLoad: true,
};
const STEP_2 = {
  name: 'QA open for Science Programs',
  audience: 'programs',
  opensOn: '2026-11-09',
  closesOn: '2026-11-13',
  round: 1,
  requiresLoad: false,
};
const STEP_3 = {
  name: 'QA open for Lead Assessors',
  audience: 'lead_assessors',
  opensOn: '2026-11-16',
  closesOn: '2026-11-20',
  round: 2,
  requiresLoad: true,
};

/** A valid request: two steps, SP02 and one result type. */
function request(
  over: Partial<CreateTimelineCommand> = {},
): CreateTimelineCommand {
  return {
    name: 'July 2026',
    allPrograms: false,
    programIds: [2],
    allResultTypes: false,
    resultTypeKeys: ['INNOVATION_DEV'],
    steps: [STEP_1, STEP_2],
    ...over,
  };
}

/** The request with scope lists left out altogether, as a body that never sent the keys. */
function requestWithout(
  omit: Array<'programIds' | 'resultTypeKeys'>,
  over: Partial<CreateTimelineCommand> = {},
): CreateTimelineCommand {
  const full = request(over);
  for (const key of omit) delete full[key];
  return full;
}

/**
 * `loads` is the `TIMELINE_LOADS` port the service reads. The default is the
 * world's fake, a real statement in the read log that a test marks as loaded
 * (timeline-edit DD-8); pass `NoTimelineLoads` to read as production does today.
 */
function world(
  options: {
    loads?: (db: InMemoryAdminConfigDatabase) => TimelineLoads;
    /** Wraps the fake unit of work the service runs in (the fake itself stays `unitOfWork`, for its counters). */
    unitOfWork?: (base: InMemoryTimelinesUnitOfWork) => TimelinesUnitOfWork;
  } = {},
) {
  const clock = new FakeClock(NOW);
  /** The clock the service reads: `clockReads` counts its calls (timeline-edit design 7.2 step 1: once per edit). */
  const clockReads = vi.fn(clock.now);
  const db = new InMemoryAdminConfigDatabase();
  const unitOfWork = new InMemoryTimelinesUnitOfWork(db);
  const programSource = { list: vi.fn(async () => PROGRAMS) };
  const resultTypeSource = { list: vi.fn(async () => RESULT_TYPES) };
  const catalogs = new CatalogService(resultTypeSource, programSource, () =>
    Date.now(),
  );
  const loads = options.loads?.(db) ?? db.loads;
  const service = new TimelinesService(
    options.unitOfWork?.(unitOfWork) ?? unitOfWork,
    db.timelineStore,
    catalogs,
    clockReads,
    loads,
  );
  /** The cycles service of the same database and the same row locks: its activation takes the lock a create takes. */
  const cycles = new CyclesService(
    new InMemoryCyclesUnitOfWork(db),
    db.store,
    clock.now,
  );
  /** Another API instance: its own service and unit of work over the same database and the same row locks. */
  const instance = () =>
    new TimelinesService(
      new InMemoryTimelinesUnitOfWork(db),
      db.timelineStore,
      catalogs,
      clock.now,
      loads,
    );
  const ctx = (actorId = 7): AdminConfigContext => ({
    actorId,
    requestId: 'req-1',
  });

  /** A committed cycle, written outside any request: `draft`, `active`, or `closed`. */
  const seedCycle = async (
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
    return id;
  };
  /** The `roles` table as seeded: the ids the assignment rows and the join of the detail use. */
  for (const [id, code] of db.roleCodeById) {
    db.base.stores.assignments.addRole({
      id,
      code,
      name: code,
      scopeType: code === 'ADMIN' ? 'global' : 'result_type',
      isActive: true,
    });
  }
  const roleId = (code: string): number => {
    for (const [id, known] of db.roleCodeById) if (known === code) return id;
    throw new Error(`seed: no role ${code}`);
  };
  /** A committed user with live grants; the name is her first name and, in lower case, her email. */
  const seedUser = async (
    name: string,
    held: Array<[string, string?]>,
    over: { isActive?: boolean } = {},
  ) => {
    const created = await db.base.stores.users.insert({
      email: `${name.toLowerCase()}@cgiar.org`,
      firstName: name,
      lastName: 'Tester',
      authSource: 'custom',
      isActive: over.isActive ?? true,
    });
    if (created.kind !== 'created') throw new Error('seed: email taken');
    for (const [code, resultTypeKey] of held) {
      await db.base.stores.assignments.insert({
        userId: created.user.id,
        roleId: roleId(code),
        resultTypeKey: resultTypeKey ?? null,
        programId: null,
      });
    }
    return created.user;
  };
  const kinds = () => db.timelines.map((t) => t.kind);
  const written = () =>
    JSON.stringify([
      db.timelines,
      db.steps,
      db.programs,
      db.resultTypes,
      db.assignments,
      db.timelineWriteLog,
    ]);
  return {
    clock,
    clockReads,
    catalogs,
    db,
    unitOfWork,
    service,
    cycles,
    instance,
    ctx,
    seedCycle,
    seedUser,
    roleId,
    kinds,
    written,
    programSource,
    resultTypeSource,
  };
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

type Settled<T> = PromiseSettledResult<T>;

/** A promise's outcome, with a handler attached at once so that a refusal never goes unhandled. */
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }) as const,
    (reason: unknown) => ({ status: 'rejected', reason }) as const,
  );

/** Fails with a clear message when a lock wait never ends (a deadlock), instead of a bare test timeout. */
function withinDeadline<T>(work: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`no answer after ${ms} ms: a lock wait that never ends`),
        ),
      ms,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Starts `first`, lets it run `ahead` statements alone (one round trip each),
 * then starts `second`; from there the two transactions run together. Sweeping
 * `ahead` walks the second one through every statement boundary of the first.
 */
async function staggered<A, B>(
  first: () => Promise<A>,
  ahead: number,
  second: () => Promise<B>,
): Promise<[Settled<A>, Settled<B>]> {
  const early = settle(first());
  for (let tick = 0; tick < ahead; tick++) await roundTrip();
  const late = settle(second());
  return withinDeadline(Promise.all([early, late]));
}

describe('default steps (FR-4)', () => {
  it('are the five steps of the FR-4 table, and a caller cannot change the next answer', () => {
    const { service } = world();

    const steps = service.defaultSteps();
    steps[0]!.name = 'changed';
    steps.pop();

    expect(service.defaultSteps()).toEqual([
      {
        position: 1,
        name: 'QA Platform open for assessors',
        audience: 'assessors',
        round: 1,
        requiresLoad: true,
      },
      {
        position: 2,
        name: 'QA open for Science Programs',
        audience: 'programs',
        round: 1,
        requiresLoad: false,
      },
      {
        position: 3,
        name: 'QA open for Lead Assessors',
        audience: 'lead_assessors',
        round: 2,
        requiresLoad: true,
      },
      {
        position: 4,
        name: 'Third-Party Broker review',
        audience: 'tpb',
        round: 2,
        requiresLoad: false,
      },
      {
        position: 5,
        name: 'PPU review',
        audience: 'ppu',
        round: 2,
        requiresLoad: false,
      },
    ]);
  });
});

describe('create: official or additional (FR-5)', () => {
  it('makes the first timeline of a cycle official, with who created it and when', async () => {
    const { service, ctx, db, seedCycle } = world();
    const cycleId = await seedCycle(2026);

    const result = await service.create(ctx(7), cycleId, request());

    expect(result).toEqual({ timelineId: 1 });
    expect(db.timelines).toEqual([
      {
        id: 1,
        cycleId,
        name: 'July 2026',
        kind: 'official',
        officialKey: cycleId,
        allPrograms: false,
        allResultTypes: false,
        createdAt: NOW,
        createdBy: 7,
        // The column defaults of a new row (timeline-edit FR-9, FR-10).
        version: 1,
        updatedAt: null,
        updatedBy: null,
      },
    ]);
  });

  it('makes a later timeline additional, whatever its scope', async () => {
    const { service, ctx, db, seedCycle, kinds } = world();
    const cycleId = await seedCycle(2026);

    await service.create(ctx(), cycleId, request());
    await service.create(ctx(), cycleId, request({ name: 'August 2026' }));
    await service.create(
      ctx(),
      cycleId,
      request({
        name: 'September 2026',
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
      }),
    );

    expect(kinds()).toEqual(['official', 'additional', 'additional']);
    expect(db.timelines.map((t) => t.officialKey)).toEqual([
      cycleId,
      null,
      null,
    ]);
  });

  it.each(['draft', 'active'] as const)(
    'accepts a timeline in a %s cycle',
    async (status) => {
      const { service, ctx, db, seedCycle } = world();
      const cycleId = await seedCycle(2026, status);

      await service.create(ctx(), cycleId, request());

      expect(db.timelines).toHaveLength(1);
    },
  );

  it('is official per cycle: the first timeline of another cycle is official too', async () => {
    const { service, ctx, seedCycle, kinds } = world();
    const first = await seedCycle(2026);
    const second = await seedCycle(2027);

    await service.create(ctx(), first, request());
    await service.create(ctx(), second, request());
    await service.create(ctx(), second, request({ name: 'August 2026' }));

    expect(kinds()).toEqual(['official', 'official', 'additional']);
  });

  it('two creates on an empty cycle at the same time: exactly one official, one additional, and the lock decided it (not the unique key)', async () => {
    const { service, ctx, db, seedCycle, unitOfWork, kinds } = world();
    const cycleId = await seedCycle(2026);

    const settled = await Promise.allSettled([
      service.create(ctx(7), cycleId, request({ name: 'July 2026' })),
      service.create(ctx(8), cycleId, request({ name: 'August 2026' })),
    ]);

    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(kinds().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'additional',
      'official',
    ]);
    expect(db.timelines.filter((t) => t.officialKey === cycleId)).toHaveLength(
      1,
    );
    // The cycle row lock serialized them: the second SAW the first's official.
    // Had the kind been decided before the lock, both would insert an official
    // and the second would be refused by `uq_timelines_official_key`.
    expect(db.officialKeyViolations).toBe(0);
    expect(unitOfWork).toMatchObject({ begun: 2, committed: 2, rolledBack: 0 });
    expect(db.steps).toHaveLength(4);
  });

  it('holds on any number of instances: five API instances create at once, one official and four additional, never a second official', async () => {
    const { instance, ctx, db, seedCycle, kinds } = world();
    const cycleId = await seedCycle(2026);
    const instances = Array.from({ length: 5 }, instance);

    const settled = await Promise.allSettled(
      instances.map((service, index) =>
        service.create(
          ctx(10 + index),
          cycleId,
          request({ name: `Timeline ${index}` }),
        ),
      ),
    );

    expect(settled.map((s) => s.status)).toEqual(Array(5).fill('fulfilled'));
    expect(kinds().filter((kind) => kind === 'official')).toHaveLength(1);
    expect(kinds().filter((kind) => kind === 'additional')).toHaveLength(4);
    expect(db.officialKeyViolations).toBe(0);
    expect(new Set(db.timelines.map((t) => t.id)).size).toBe(5);
  });

  it('creates in different cycles do not block each other: both are official, and their writes interleave', async () => {
    const { service, ctx, db, seedCycle, kinds } = world();
    const first = await seedCycle(2026);
    const second = await seedCycle(2027);
    db.history.length = 0;

    const created = await Promise.allSettled([
      service.create(ctx(7), first, request({ name: 'July 2026' })),
      service.create(ctx(8), second, request({ name: 'July 2026' })),
    ]);

    expect(created.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(kinds()).toEqual(['official', 'official']);
    expect(db.timelines.map((t) => t.cycleId)).toEqual([first, second]);
    // Both timelines were inserted before either one's scope rows: neither
    // transaction waited for the other (a shared lock would run them in turn).
    expect(new Set(db.history.slice(0, 2))).toEqual(
      new Set(['timeline:official:1', 'timeline:official:2']),
    );
  });

  it('the unique key is the backstop: a read that wrongly says "no official" is refused by `official_key` and retried once as additional, in the same transaction', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    await w.service.create(w.ctx(), cycleId, request());
    const lying: TimelinesUnitOfWork = {
      run: (work) =>
        w.unitOfWork.run((repositories) => {
          const t = repositories.timelines;
          return work({
            ...repositories,
            timelines: {
              insert: (values) => t.insert(values),
              hasOfficial: async () => false,
              insertPrograms: (...args) => t.insertPrograms(...args),
              insertResultTypes: (...args) => t.insertResultTypes(...args),
              insertSteps: (...args) => t.insertSteps(...args),
              findById: (id) => t.findById(id),
              cycleExists: (id) => t.cycleExists(id),
              listByCycle: (id) => t.listByCycle(id),
              listSteps: (ids) => t.listSteps(ids),
              listPrograms: (ids) => t.listPrograms(ids),
              listResultTypes: (ids) => t.listResultTypes(ids),
              countAssigned: (ids) => t.countAssigned(ids),
              listActiveAssignments: (id) => t.listActiveAssignments(id),
              lockCycleShared: (id) => t.lockCycleShared(id),
              findRoleId: (code) => t.findRoleId(code),
              insertAssignment: (values) => t.insertAssignment(values),
              findActiveAssignment: (...args) =>
                t.findActiveAssignment(...args),
              removeAssignment: (change) => t.removeAssignment(change),
              findBundle: (id) => t.findBundle(id),
              findForUpdate: (id) => t.findForUpdate(id),
              updateTimeline: (...args) => t.updateTimeline(...args),
              updateStep: (...args) => t.updateStep(...args),
              replacePrograms: (...args) => t.replacePrograms(...args),
              replaceResultTypes: (...args) => t.replaceResultTypes(...args),
              insertAuditEvent: (values) => t.insertAuditEvent(values),
            },
          });
        }),
    };
    const service = new TimelinesService(
      lying,
      w.db.timelineStore,
      new CatalogService(w.resultTypeSource, w.programSource, () => Date.now()),
      w.clock.now,
      w.db.loads,
    );

    const result = await service.create(
      w.ctx(),
      cycleId,
      request({ name: 'August 2026' }),
    );

    // The refused insert burned an id, as AUTO_INCREMENT does: the answer is the stored row.
    expect(result).toEqual({ timelineId: w.db.timelines[1]!.id });
    expect(w.kinds()).toEqual(['official', 'additional']);
    expect(w.db.officialKeyViolations).toBe(1);
    expect(w.db.steps).toHaveLength(4);
  });

  it('refuses a closed cycle with 409 CYCLES_CLOSED and writes nothing', async () => {
    const { service, ctx, seedCycle, written, unitOfWork } = world();
    const cycleId = await seedCycle(2026, 'closed');
    const before = written();

    const error = await refusal(service.create(ctx(), cycleId, request()));

    expect(error).toBeInstanceOf(CycleClosedError);
    expect((error as CycleClosedError).getStatus()).toBe(409);
    expect((error as CycleClosedError).getResponse()).toMatchObject({
      code: 'CYCLES_CLOSED',
    });
    expect(written()).toBe(before);
    expect(unitOfWork.rolledBack).toBe(1);
  });

  it('refuses an unknown cycle with 404 CYCLES_NOT_FOUND and writes nothing', async () => {
    const { service, ctx, written } = world();
    const before = written();

    const error = await refusal(service.create(ctx(), 99, request()));

    expect(error).toBeInstanceOf(CycleNotFoundError);
    expect((error as CycleNotFoundError).getStatus()).toBe(404);
    expect(written()).toBe(before);
  });
});

// design 7.3, the 2026-10-21 Activate amendment, and DD-9: a create locks the
// cycle row `FOR UPDATE`, the row an activation locks, so the two serialize.
// One database, one set of row locks, a round trip per statement: the sweep
// starts one of the two `ahead` statements before the other, for every `ahead`
// that crosses a statement of the first, in both orders. A create writes the
// four entries below (a timeline, its programs, result types and steps); an
// activation of 2027 over the active 2026 writes `close:1`, `activate:2`.
describe('create racing an activation of a cycle (design 7.3, DD-9)', () => {
  const AHEAD = [0, 1, 2, 3, 4, 5, 6, 7];
  const SWEEP = (['create', 'activate'] as const).flatMap((first) =>
    AHEAD.map((ahead) => [first, ahead] as const),
  );
  /** The first timeline of the world (id 1): its four writes, in order. */
  const CREATE_WRITES = [
    'timeline:official:1',
    'programs:1',
    'result-types:1',
    'steps:1',
  ];
  const ACTIVATION = ['close:1', 'activate:2'];

  /** 2026 is active (id 1), 2027 is a draft (id 2); the create goes to `inCycle`, the activation to 2027. */
  async function race(
    inCycle: 1 | 2,
    first: 'create' | 'activate',
    ahead: number,
  ) {
    const w = world();
    await w.seedCycle(2026, 'active');
    await w.seedCycle(2027);
    w.db.history.length = 0;
    const create = () => w.service.create(w.ctx(7), inCycle, request());
    const activate = () => w.cycles.activate(w.ctx(8), 2);
    const [created, activated] =
      first === 'create'
        ? await staggered(create, ahead, activate).then(
            ([a, b]) => [a, b] as const,
          )
        : await staggered(activate, ahead, create).then(
            ([a, b]) => [b, a] as const,
          );
    return { w, created, activated };
  }
  const statuses = (db: InMemoryAdminConfigDatabase) =>
    db.cycles.map((c) => [c.year, c.status]);

  it.each(SWEEP)(
    'a create in the cycle being activated, %s first and %i statements ahead: both succeed, one after the other, and the cycles end right',
    async (first, ahead) => {
      const { w, created, activated } = await race(2, first, ahead);

      expect(created.status).toBe('fulfilled');
      expect(activated.status).toBe('fulfilled');
      expect(statuses(w.db)).toEqual([
        [2026, 'closed'],
        [2027, 'active'],
      ]);
      expect(w.db.cycles.filter((c) => c.status === 'active')).toHaveLength(1);
      expect(w.db.timelines.map((t) => [t.cycleId, t.kind])).toEqual([
        [2, 'official'],
      ]);
      // Whole create, then whole activation, or the other way round: never mixed.
      expect(w.db.history).toEqual(
        w.db.history[0] === 'close:1'
          ? [...ACTIVATION, ...CREATE_WRITES]
          : [...CREATE_WRITES, ...ACTIVATION],
      );
    },
  );

  it('the sweep reaches both orders of a create and an activation of one cycle', async () => {
    const orders = new Set<string>();
    for (const [first, ahead] of SWEEP) {
      const { w } = await race(2, first, ahead);
      orders.add(
        w.db.history[0]!.startsWith('timeline')
          ? 'create-first'
          : 'activation-first',
      );
    }

    expect([...orders].sort()).toEqual(['activation-first', 'create-first']);
  });

  it.each(SWEEP)(
    'a create in the active cycle that the activation closes, %s first and %i statements ahead: it is written before the close, or refused as closed, never written into a closed cycle',
    async (first, ahead) => {
      const { w, created, activated } = await race(1, first, ahead);

      expect(activated.status).toBe('fulfilled');
      expect(statuses(w.db)).toEqual([
        [2026, 'closed'],
        [2027, 'active'],
      ]);
      if (created.status === 'fulfilled') {
        // Serial order: the create, then the activation.
        expect(w.db.history).toEqual([...CREATE_WRITES, ...ACTIVATION]);
        expect(w.db.timelines.map((t) => [t.cycleId, t.kind])).toEqual([
          [1, 'official'],
        ]);
      } else {
        // Serial order: the activation, then a create that finds the cycle closed.
        expect(created.reason).toBeInstanceOf(CycleClosedError);
        expect(w.db.history).toEqual(ACTIVATION);
        expect(w.db.timelines).toEqual([]);
        expect(w.db.steps).toEqual([]);
      }
    },
  );

  it('the sweep reaches both outcomes of a create in the cycle that is being closed', async () => {
    const outcomes = new Set<string>();
    for (const [first, ahead] of SWEEP) {
      const { created } = await race(1, first, ahead);
      outcomes.add(created.status);
    }

    expect([...outcomes].sort()).toEqual(['fulfilled', 'rejected']);
  });
});

describe('create: name (FR-6)', () => {
  it('refuses a name taken in the cycle whatever the letter case with 409 TIMELINES_NAME_TAKEN, and writes nothing more', async () => {
    const { service, ctx, seedCycle, written, db } = world();
    const cycleId = await seedCycle(2026);
    await service.create(ctx(), cycleId, request({ name: 'July 2026' }));
    const before = written();

    const error = await refusal(
      service.create(ctx(), cycleId, request({ name: 'july 2026' })),
    );

    expect(error).toBeInstanceOf(TimelineNameTakenError);
    expect((error as TimelineNameTakenError).getStatus()).toBe(409);
    expect((error as TimelineNameTakenError).getResponse()).toMatchObject({
      code: 'TIMELINES_NAME_TAKEN',
    });
    expect(written()).toBe(before);
    expect(db.nameViolations).toBe(1);
  });

  it('allows the same name in another cycle', async () => {
    const { service, ctx, seedCycle, db } = world();
    const first = await seedCycle(2026);
    const second = await seedCycle(2027);
    await service.create(ctx(), first, request({ name: 'July 2026' }));

    await service.create(ctx(), second, request({ name: 'july 2026' }));

    expect(db.timelines.map((t) => [t.cycleId, t.name])).toEqual([
      [first, 'July 2026'],
      [second, 'july 2026'],
    ]);
  });

  it('trims the name before it is stored and compared', async () => {
    const { service, ctx, seedCycle, db } = world();
    const cycleId = await seedCycle(2026);
    await service.create(ctx(), cycleId, request({ name: '  July 2026  ' }));

    const error = await refusal(
      service.create(ctx(), cycleId, request({ name: 'JULY 2026' })),
    );

    expect(db.timelines.map((t) => t.name)).toEqual(['July 2026']);
    expect(error).toBeInstanceOf(TimelineNameTakenError);
  });

  it('two creates of one name at the same time: one is created, the other is refused with 409', async () => {
    const { service, ctx, seedCycle, db, unitOfWork } = world();
    const cycleId = await seedCycle(2026);

    const settled = await Promise.allSettled([
      service.create(ctx(7), cycleId, request({ name: 'July 2026' })),
      service.create(ctx(8), cycleId, request({ name: 'JULY 2026' })),
    ]);

    expect(
      settled.map((s) => s.status).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(['fulfilled', 'rejected']);
    const rejected = settled.find((s) => s.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      TimelineNameTakenError,
    );
    expect(db.timelines).toHaveLength(1);
    expect(db.steps).toHaveLength(2);
    expect(unitOfWork).toMatchObject({ committed: 1, rolledBack: 1 });
  });
});

describe('create: scope (FR-6)', () => {
  it('stores exactly the programs and result types asked for, each once', async () => {
    const { service, ctx, seedCycle, db } = world();
    const cycleId = await seedCycle(2026);

    const { timelineId } = await service.create(
      ctx(),
      cycleId,
      request({
        programIds: [3, 2, 3],
        resultTypeKeys: ['KP', 'INNOVATION_DEV', 'KP'],
      }),
    );

    expect(
      db.programs
        .map((r) => r.programId)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([2, 3]);
    expect(
      db.resultTypes
        .map((r) => r.resultTypeKey)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(['INNOVATION_DEV', 'KP']);
    expect(await service.get(timelineId)).toMatchObject({
      allPrograms: false,
      programIds: [2, 3],
      allResultTypes: false,
      resultTypeKeys: ['INNOVATION_DEV', 'KP'],
    });
  });

  it('"all" stores the flag and no rows, and asks neither catalog', async () => {
    const { service, ctx, seedCycle, db, programSource, resultTypeSource } =
      world();
    const cycleId = await seedCycle(2026);

    const { timelineId } = await service.create(
      ctx(),
      cycleId,
      request({
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
      }),
    );

    expect(db.timelines[0]).toMatchObject({
      allPrograms: true,
      allResultTypes: true,
    });
    expect(db.programs).toEqual([]);
    expect(db.resultTypes).toEqual([]);
    expect(programSource.list).not.toHaveBeenCalled();
    expect(resultTypeSource.list).not.toHaveBeenCalled();
    expect(await service.get(timelineId)).toMatchObject({
      allPrograms: true,
      programIds: [],
      allResultTypes: true,
      resultTypeKeys: [],
    });
  });

  it('an empty list is not "all": it is refused on its field before any transaction', async () => {
    const { service, ctx, seedCycle, written, unitOfWork } = world();
    const cycleId = await seedCycle(2026);
    const before = written();

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({ programIds: [], resultTypeKeys: [] }),
      ),
    );

    expect(error).toBeInstanceOf(TimelineValidationError);
    expect((error as TimelineValidationError).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [
        { field: 'programIds', code: 'REQUIRED' },
        { field: 'resultTypeKeys', code: 'REQUIRED' },
      ],
    });
    expect(written()).toBe(before);
    expect(unitOfWork.begun).toBe(0);
  });

  it('a list that is absent is not "all": it is refused on its field like an empty one, before any transaction and without asking a catalog', async () => {
    const { service, ctx, seedCycle, written, unitOfWork, programSource } =
      world();
    const cycleId = await seedCycle(2026);
    const before = written();

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        requestWithout(['programIds', 'resultTypeKeys']),
      ),
    );

    expect(error).toBeInstanceOf(TimelineValidationError);
    expect((error as TimelineValidationError).issues).toEqual([
      { field: 'programIds', code: 'REQUIRED' },
      { field: 'resultTypeKeys', code: 'REQUIRED' },
    ]);
    expect(programSource.list).not.toHaveBeenCalled();
    expect(written()).toBe(before);
    expect(unitOfWork.begun).toBe(0);
  });

  it('"all" with the list absent stores the flag and no rows, as with an empty list', async () => {
    const { service, ctx, seedCycle, db } = world();
    const cycleId = await seedCycle(2026);

    const { timelineId } = await service.create(
      ctx(),
      cycleId,
      requestWithout(['programIds', 'resultTypeKeys'], {
        allPrograms: true,
        allResultTypes: true,
      }),
    );

    expect(db.timelines[0]).toMatchObject({
      id: timelineId,
      allPrograms: true,
      allResultTypes: true,
    });
    expect(db.programs).toEqual([]);
    expect(db.resultTypes).toEqual([]);
  });

  it('refuses an id or key the catalog does not have, naming the field', async () => {
    const { service, ctx, seedCycle, written, unitOfWork } = world();
    const cycleId = await seedCycle(2026);
    const before = written();

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({ programIds: [2, 99], resultTypeKeys: ['NOPE'] }),
      ),
    );

    expect((error as TimelineValidationError).issues).toEqual([
      { field: 'programIds', code: 'INVALID' },
      { field: 'resultTypeKeys', code: 'INVALID' },
    ]);
    expect(written()).toBe(before);
    expect(unitOfWork.begun).toBe(0);
  });

  it.each([
    ['the Science Programs catalog', 'programSource'],
    ['the result types catalog', 'resultTypeSource'],
  ] as const)(
    'when %s cannot be read: 503 SERVICE_UNAVAILABLE, no transaction, nothing written',
    async (_label, which) => {
      const w = world();
      const cycleId = await w.seedCycle(2026);
      w[which].list.mockRejectedValue(new UpstreamUnavailableError());
      const before = w.written();

      const error = await refusal(
        w.service.create(w.ctx(), cycleId, request()),
      );

      expect(error).toBeInstanceOf(UpstreamUnavailableError);
      expect((error as UpstreamUnavailableError).getStatus()).toBe(503);
      expect((error as UpstreamUnavailableError).getResponse()).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(w.written()).toBe(before);
      expect(w.unitOfWork.begun).toBe(0);
    },
  );

  it('a catalog the request does not need is not asked: "all" programs still work while CLARISA is down', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    w.programSource.list.mockRejectedValue(new UpstreamUnavailableError());

    await w.service.create(
      w.ctx(),
      cycleId,
      request({ allPrograms: true, programIds: [] }),
    );

    expect(w.db.timelines).toHaveLength(1);
    expect(w.programSource.list).not.toHaveBeenCalled();
  });
});

describe('create: every problem at once, nothing written (FR-11)', () => {
  it('lists the empty name, the missing programs and the step without a closing date in one error, with catalog messages', async () => {
    const { service, ctx, seedCycle, written, unitOfWork } = world();
    const cycleId = await seedCycle(2026);
    const before = written();
    const { closesOn: _missing, ...noClose } = STEP_3;

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({
          name: '',
          programIds: [],
          steps: [STEP_1, STEP_2, noClose],
        }),
      ),
    );

    expect(error).toBeInstanceOf(TimelineValidationError);
    expect((error as TimelineValidationError).getStatus()).toBe(400);
    expect((error as TimelineValidationError).getResponse()).toEqual({
      code: 'VALIDATION_FAILED',
      message: expect.any(String),
      fields: [
        { field: 'name', code: 'REQUIRED', message: 'This field is required.' },
        {
          field: 'programIds',
          code: 'REQUIRED',
          message: 'This field is required.',
        },
        {
          field: 'steps[2].closesOn',
          code: 'REQUIRED',
          message: 'This field is required.',
        },
      ],
    });
    expect(written()).toBe(before);
    expect(unitOfWork.begun).toBe(0);
  });

  it('the same three problems with `programIds` ABSENT (not empty) come back in the same one error', async () => {
    const { service, ctx, seedCycle, written, unitOfWork } = world();
    const cycleId = await seedCycle(2026);
    const before = written();
    const { closesOn: _missing, ...noClose } = STEP_3;
    const absent = requestWithout(['programIds'], {
      name: '',
      steps: [STEP_1, STEP_2, noClose],
    });
    expect('programIds' in absent).toBe(false);

    const error = await refusal(service.create(ctx(), cycleId, absent));

    expect((error as TimelineValidationError).getResponse()).toEqual({
      code: 'VALIDATION_FAILED',
      message: expect.any(String),
      fields: [
        { field: 'name', code: 'REQUIRED', message: 'This field is required.' },
        {
          field: 'programIds',
          code: 'REQUIRED',
          message: 'This field is required.',
        },
        {
          field: 'steps[2].closesOn',
          code: 'REQUIRED',
          message: 'This field is required.',
        },
      ],
    });
    expect(written()).toBe(before);
    expect(unitOfWork.begun).toBe(0);
  });

  it('does not stop at the first problem across the name, the catalog scope and the steps', async () => {
    const { service, ctx, seedCycle } = world();
    const cycleId = await seedCycle(2026);

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({
          name: 'x'.repeat(121),
          programIds: [99],
          steps: [
            {
              ...STEP_1,
              opensOn: '2026-10-19',
              requiresLoad: false,
            },
            { ...STEP_2, closesOn: '2026-11-08' },
          ],
        }),
      ),
    );

    expect(
      (error as TimelineValidationError).issues.map((i) => [i.field, i.code]),
    ).toEqual([
      ['name', 'TOO_LONG'],
      ['programIds', 'INVALID'],
      ['steps[0].opensOn', 'BEFORE_TODAY'],
      ['steps[0].requiresLoad', 'FIRST_STEP_LOAD'],
      ['steps[1].closesOn', 'CLOSES_BEFORE_OPENS'],
    ]);
  });

  it('judges "now" to the Rome minute (S-4, FR-5): at 12:00 Rome on 20 Oct a day-only step opening that day (00:00) is back-dated, and one opening on 21 Oct is accepted', async () => {
    const { service, ctx, seedCycle, db, written } = world();
    const cycleId = await seedCycle(2026);
    const before = written();

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({ steps: [{ ...STEP_1, opensOn: '2026-10-20' }, STEP_2] }),
      ),
    );
    expect((error as TimelineValidationError).issues).toEqual([
      { field: 'steps[0].opensOn', code: 'BEFORE_TODAY' },
    ]);
    expect(written()).toBe(before);

    await service.create(
      ctx(),
      cycleId,
      request({ steps: [{ ...STEP_1, opensOn: '2026-10-21' }, STEP_2] }),
    );
    expect(db.timelines).toHaveLength(1);
  });

  it('judges "today" by the Rome date: 22:30 UTC on 20 Oct is already 21 Oct in Rome, so a step opening on 20 Oct is back-dated', async () => {
    const { service, ctx, seedCycle, clock, written } = world();
    const cycleId = await seedCycle(2026);
    clock.advance(12.5 * 60 * 60 * 1000);
    const before = written();

    const error = await refusal(
      service.create(
        ctx(),
        cycleId,
        request({ steps: [{ ...STEP_1, opensOn: '2026-10-20' }, STEP_2] }),
      ),
    );

    expect((error as TimelineValidationError).issues).toEqual([
      { field: 'steps[0].opensOn', code: 'BEFORE_TODAY' },
    ]);
    expect(written()).toBe(before);
  });
});

describe('the timeline as read (FR-12 read model, P-1 replay)', () => {
  it('answers the stored timeline with its status, current step and readiness, and zero assignments', async () => {
    const { service, ctx, seedCycle } = world();
    const cycleId = await seedCycle(2026);
    const { timelineId } = await service.create(ctx(), cycleId, request());

    expect(await service.get(timelineId)).toEqual({
      id: 1,
      cycleId,
      name: 'July 2026',
      kind: 'official',
      allPrograms: false,
      programIds: [2],
      allResultTypes: false,
      resultTypeKeys: ['INNOVATION_DEV'],
      steps: [
        { position: 1, ...STEP_1, state: 'upcoming' },
        { position: 2, ...STEP_2, state: 'upcoming' },
      ],
      status: 'scheduled',
      currentStep: null,
      nextStep: 1,
      readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
      assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
      createdAt: NOW,
      version: 1,
    });
  });

  it('keeps the kind it was created with: an official timeline still reads official after another one exists', async () => {
    const { service, ctx, seedCycle } = world();
    const cycleId = await seedCycle(2026);
    const first = await service.create(ctx(), cycleId, request());
    const second = await service.create(
      ctx(),
      cycleId,
      request({ name: 'August 2026' }),
    );

    expect((await service.get(first.timelineId)).kind).toBe('official');
    expect((await service.get(second.timelineId)).kind).toBe('additional');
  });

  it('answers 404 TIMELINES_NOT_FOUND for an unknown timeline', async () => {
    const { service } = world();

    const error = await refusal(service.get(99));

    expect(error).toBeInstanceOf(TimelineNotFoundError);
    expect((error as TimelineNotFoundError).getStatus()).toBe(404);
  });
});

describe('the hold, through the loads port (timeline-edit FR-6, FR-2, FR-14)', () => {
  const read = async (w: ReturnType<typeof world>, timelineId: number) => {
    const t = await w.service.get(timelineId);
    return {
      status: t.status,
      currentStep: t.currentStep,
      nextStep: t.nextStep,
      states: t.steps.map((step) => step.state),
    };
  };

  it('step 1 date arrives without a load: waiting for load, no current step, next step 1, every step upcoming', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    // 00:00 Rome on 2 Nov, step 1's opening day (CET, UTC+1)
    w.clock.advance(Date.parse('2026-11-01T23:00:00Z') - NOW.getTime());

    expect(await read(w, timelineId)).toEqual({
      status: 'waiting_for_load',
      currentStep: null,
      nextStep: 1,
      states: ['upcoming', 'upcoming'],
    });
  });

  it('all dates passed without a load: still waiting for load, not finished', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    w.clock.advance(Date.parse('2026-12-01T00:00:00Z') - NOW.getTime());

    expect((await read(w, timelineId)).status).toBe('waiting_for_load');
  });

  it('a load present gives the delivered behavior: live, current step 1, step states from the dates', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    w.db.loads.markLoaded(timelineId);
    w.clock.advance(Date.parse('2026-11-01T23:00:00Z') - NOW.getTime());

    expect(await read(w, timelineId)).toEqual({
      status: 'live',
      currentStep: 1,
      nextStep: 2,
      states: ['in_progress', 'upcoming'],
    });
  });

  it('holds only the timeline without a load when two are read together', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const first = await w.service.create(w.ctx(), cycleId, request());
    const second = await w.service.create(
      w.ctx(),
      cycleId,
      request({ name: 'August 2026' }),
    );
    w.db.loads.markLoaded(second.timelineId);
    w.clock.advance(Date.parse('2026-11-01T23:00:00Z') - NOW.getTime());

    const list = await w.service.listByCycle(cycleId);

    expect(
      list
        .map((t) => [t.id, t.status])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [first.timelineId, 'waiting_for_load'],
      [second.timelineId, 'live'],
    ]);
  });
});

describe('step times: stored to the minute and judged by the Rome minute (timeline-step-times FR-2, FR-7, FR-9, FR-11)', () => {
  /** Rewrites a stored step as a migrated or future row would hold it. */
  const setStep = (
    w: ReturnType<typeof world>,
    timelineId: number,
    position: number,
    opensAt: string,
    closesAt: string,
  ) => {
    const row = w.db.steps.find(
      (s) => s.timelineId === timelineId && s.position === position,
    )!;
    row.opensAt = opensAt as RomeMinute;
    row.closesAt = closesAt as RomeMinute;
  };
  /** Moves the clock to an instant (UTC) of the same run. */
  const goTo = (w: ReturnType<typeof world>, instant: string) =>
    w.clock.advance(Date.parse(instant) - w.clock.now().getTime());

  it('FR-1 a create with moments stores exactly those moments, and the insert reads them as the rules did (timeline-step-times T-4)', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(
      w.ctx(),
      cycleId,
      request({
        steps: [
          {
            name: STEP_1.name,
            audience: 'assessors',
            opensAt: '2026-11-10T14:00',
            closesAt: '2026-11-10T17:30',
            round: 1,
            requiresLoad: true,
          },
          {
            name: STEP_2.name,
            audience: 'programs',
            opensAt: '2026-11-10T17:31',
            closesOn: '2026-11-13',
            round: 1,
            requiresLoad: false,
          },
        ],
      }),
    );

    expect(
      w.db.steps
        .filter((s) => s.timelineId === timelineId)
        .sort((a, b) => a.position - b.position)
        .map((s) => [s.opensAt, s.closesAt]),
    ).toEqual([
      ['2026-11-10T14:00', '2026-11-10T17:30'],
      ['2026-11-10T17:31', '2026-11-13T23:59'],
    ]);
  });

  it('an old client create (day-only) is stored from 00:00 of the opening day to 23:59 of the closing day, and both forms are answered', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());

    expect(
      w.db.steps
        .filter((s) => s.timelineId === timelineId)
        .sort((a, b) => a.position - b.position)
        .map((s) => [s.opensAt, s.closesAt]),
    ).toEqual([
      ['2026-11-02T00:00', '2026-11-06T23:59'],
      ['2026-11-09T00:00', '2026-11-13T23:59'],
    ]);
    const answer = await w.service.get(timelineId);
    expect(answer.steps.map((step) => [step.opensOn, step.closesOn])).toEqual([
      ['2026-11-02', '2026-11-06'],
      ['2026-11-09', '2026-11-13'],
    ]);
  });

  it('the hold starts at the opening hour: scheduled at 13:59 and waiting for load at 14:00, not at 00:00', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    setStep(w, timelineId, 1, '2026-11-10T14:00', '2026-11-12T17:30');
    setStep(w, timelineId, 2, '2026-11-13T00:00', '2026-11-13T23:59');

    goTo(w, '2026-11-09T23:00:00Z'); // 00:00 Rome on 10 Nov
    expect((await w.service.get(timelineId)).status).toBe('scheduled');
    goTo(w, '2026-11-10T12:59:00Z'); // 13:59 Rome
    expect((await w.service.get(timelineId)).status).toBe('scheduled');
    goTo(w, '2026-11-10T13:00:00Z'); // 14:00 Rome
    expect((await w.service.get(timelineId)).status).toBe('waiting_for_load');
  });

  it('with a load, a step 14:00-17:30 is upcoming at 13:59:59, in progress at 14:00:00 and 17:30:59, closed at 17:31:00', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    w.db.loads.markLoaded(timelineId);
    setStep(w, timelineId, 1, '2026-11-10T14:00', '2026-11-12T17:30');
    setStep(w, timelineId, 2, '2026-11-13T00:00', '2026-11-13T23:59');

    const state = async () => (await w.service.get(timelineId)).steps[0]!.state;
    goTo(w, '2026-11-10T12:59:59Z');
    expect(await state()).toBe('upcoming');
    goTo(w, '2026-11-10T13:00:00Z');
    expect(await state()).toBe('in_progress');
    goTo(w, '2026-11-12T16:30:59Z');
    expect(await state()).toBe('in_progress');
    goTo(w, '2026-11-12T16:31:00Z');
    expect(await state()).toBe('closed');
  });

  it('a migrated timeline (00:00 / 23:59) answers as the day timeline did: live through 23:59:59 of the closing day, finished at 00:00 after', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    w.db.loads.markLoaded(timelineId);

    goTo(w, '2026-11-13T22:59:59Z'); // 23:59:59 Rome on 13 Nov, step 2's last day
    expect((await w.service.get(timelineId)).status).toBe('live');
    goTo(w, '2026-11-13T23:00:00Z'); // 00:00 on 14 Nov
    expect((await w.service.get(timelineId)).status).toBe('finished');
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

  it('marks the key executed in the same transaction as the timeline, with the timeline id as the target', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { store, ctx } = await keyed(w);

    await w.service.create(ctx, cycleId, request());

    expect(store.peek(7, 'key-1')).toMatchObject({
      state: 'executed',
      targetUserId: 1,
    });
    expect(w.db.timelines).toHaveLength(1);
  });

  it('a refused create does not mark the key', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    await w.service.create(w.ctx(), cycleId, request());
    const { store, ctx } = await keyed(w);

    await refusal(w.service.create(ctx, cycleId, request()));

    expect(store.peek(7, 'key-1')).toMatchObject({ state: 'in_progress' });
  });

  it('a request that lost its key to a take-over rolls the timeline back', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { store, ctx } = await keyed(w);
    // Another request took the key over: the owner token is no longer ours.
    store.seed({ ...store.peek(7, 'key-1')!, ownerToken: 'someone-else' });

    const error = await refusal(w.service.create(ctx, cycleId, request()));

    expect(error).toBeInstanceOf(IdempotencyFenceLostError);
    expect(w.db.timelines).toEqual([]);
    expect(w.db.steps).toEqual([]);
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
    action: 'timeline_create',
    actorId: 7,
    requestId: 'req-1',
    idempotency: 'none',
  };

  it('a create writes one line with ids and fixed words, and never the name or the scope', async () => {
    const { service, ctx, seedCycle } = world();
    const cycleId = await seedCycle(2026);

    await service.create(ctx(), cycleId, request());

    expect(lines).toEqual([
      { level: 'log', line: { ...base, targetId: 1, outcome: 'ok' } },
    ]);
    expect(JSON.stringify(lines)).not.toContain('July');
  });

  it.each([
    [
      'a taken name',
      409,
      'TIMELINES_NAME_TAKEN',
      (w: ReturnType<typeof world>, cycleId: number) =>
        w.service.create(w.ctx(), cycleId, request()),
    ],
    [
      'a request that breaks rules',
      400,
      'VALIDATION_FAILED',
      (w: ReturnType<typeof world>, cycleId: number) =>
        w.service.create(w.ctx(), cycleId, request({ name: '' })),
    ],
    [
      'a catalog that cannot be read',
      503,
      'SERVICE_UNAVAILABLE',
      (w: ReturnType<typeof world>, cycleId: number) => {
        w.programSource.list.mockRejectedValue(new UpstreamUnavailableError());
        return w.service.create(
          w.ctx(),
          cycleId,
          request({ name: 'Another name' }),
        );
      },
    ],
    [
      'an unknown cycle',
      404,
      'CYCLES_NOT_FOUND',
      (w: ReturnType<typeof world>) =>
        w.service.create(w.ctx(), 99, request({ name: 'Another name' })),
    ],
  ])(
    '%s writes one line (warn for a refusal, error for a 5xx) with the catalog code as the reason',
    async (_label, status, code, run) => {
      const w = world();
      const cycleId = await w.seedCycle(2026);
      // "All" asks no catalog, so the catalog service holds no copy yet and a
      // failing source is really asked later.
      await w.service.create(
        w.ctx(),
        cycleId,
        request({
          allPrograms: true,
          programIds: [],
          allResultTypes: true,
          resultTypeKeys: [],
        }),
      );
      lines.length = 0;

      await refusal(run(w, cycleId));

      // A 5xx is an error line, every refusal below it a warn line (as cycles).
      const refused = status < 500;
      expect(lines).toEqual([
        {
          level: refused ? 'warn' : 'error',
          line: {
            ...base,
            targetId: null,
            outcome: refused ? 'refused' : 'error',
            reason: code,
          },
        },
      ]);
    },
  );

  it('reads and the defaults write no line', async () => {
    const { service, ctx, seedCycle } = world();
    const cycleId = await seedCycle(2026);
    const { timelineId } = await service.create(ctx(), cycleId, request());
    lines.length = 0;

    await service.get(timelineId);
    service.defaultSteps();

    expect(lines).toEqual([]);
  });
});

// FR-12 (list, detail, ordering, unknown ids, open and close by date), FR-13
// (readiness from the active assignments), NFR-5 (a fixed number of statements)
// and design 6, 7.4, 7.7, as literals.
describe('the timelines of a cycle and the detail (FR-12, FR-13, NFR-5)', () => {
  const assignment = (
    timelineId: number,
    roleId: number,
    removed = false,
  ): TimelineUser => ({
    id: Math.floor(Math.random() * 1e9),
    timelineId,
    userId: 1,
    roleId,
    assignedAt: SEEDED_AT,
    assignedBy: 1,
    removedAt: removed ? SEEDED_AT : null,
    removedBy: removed ? 1 : null,
    activeKey: removed ? null : `${timelineId}:1:${roleId}`,
  });

  it('runs the same number of statements for 1 timeline and for 50, six with NoTimelineLoads (NFR-5)', async () => {
    const noLoads = () => new NoTimelineLoads();
    const one = world({ loads: noLoads });
    const oneCycle = await one.seedCycle(2026);
    await one.service.create(one.ctx(), oneCycle, request({ name: 'T0' }));
    one.db.timelineReadLog.length = 0;
    expect(await one.service.listByCycle(oneCycle)).toHaveLength(1);
    const forOne = one.db.timelineReadLog.length;

    const many = world({ loads: noLoads });
    const manyCycle = await many.seedCycle(2026);
    for (let i = 0; i < 50; i++) {
      await many.service.create(
        many.ctx(),
        manyCycle,
        request({ name: `T${i}` }),
      );
    }
    many.db.timelineReadLog.length = 0;
    expect(await many.service.listByCycle(manyCycle)).toHaveLength(50);
    const forMany = many.db.timelineReadLog.length;

    // cycle, timelines, steps, programs, result types, assignment counts
    expect(forOne).toBe(6);
    expect(forMany).toBe(6);
    expect(
      many.db.timelineReadLog.filter((q) => q.startsWith('steps:')),
    ).toHaveLength(1);
    // NoTimelineLoads makes no query: nothing of the loads port reached the log.
    expect(many.db.timelineReadLog.some((q) => q.startsWith('loads:'))).toBe(
      false,
    );
  });

  it('runs one more, fixed statement when the loads port is queried: 7 for 1 timeline and for 50 (NFR-5)', async () => {
    // The default world binds the fake loads port, a real statement in the read
    // log: a count that skipped it would read 6 here, and the checks on
    // `calls` and on the `loads:` entry fail if it is bypassed.
    const one = world();
    const oneCycle = await one.seedCycle(2026);
    await one.service.create(one.ctx(), oneCycle, request({ name: 'T0' }));
    one.db.timelineReadLog.length = 0;
    one.db.loads.calls = 0;
    expect(await one.service.listByCycle(oneCycle)).toHaveLength(1);
    const forOne = one.db.timelineReadLog.length;
    expect(one.db.loads.calls).toBe(1);

    const many = world();
    const manyCycle = await many.seedCycle(2026);
    for (let i = 0; i < 50; i++) {
      await many.service.create(
        many.ctx(),
        manyCycle,
        request({ name: `T${i}` }),
      );
    }
    many.db.timelineReadLog.length = 0;
    many.db.loads.calls = 0;
    expect(await many.service.listByCycle(manyCycle)).toHaveLength(50);
    const forMany = many.db.timelineReadLog.length;

    // cycle, timelines, steps, programs, result types, assignment counts, loads
    expect(forOne).toBe(7);
    expect(forMany).toBe(7);
    expect(many.db.loads.calls).toBe(1);
    const asked = many.db.timelineReadLog.filter((q) => q.startsWith('loads:'));
    expect(asked).toHaveLength(1);
    expect(asked[0].slice('loads:'.length).split(',')).toHaveLength(50);
  });

  it('asks the loads port once for the detail, with the id of its timeline', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    w.db.timelineReadLog.length = 0;

    await w.service.detail(timelineId);

    expect(w.db.timelineReadLog.filter((q) => q.startsWith('loads:'))).toEqual([
      `loads:${timelineId}`,
    ]);
  });

  it('puts the official timeline first, then the additional ones newest first', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    for (const name of ['Official', 'Older', 'Newer']) {
      await w.service.create(w.ctx(), cycleId, request({ name }));
      w.clock.advance(60_000);
    }

    const list = await w.service.listByCycle(cycleId);

    expect(list.map((t) => [t.name, t.kind])).toEqual([
      ['Official', 'official'],
      ['Newer', 'additional'],
      ['Older', 'additional'],
    ]);
  });

  it('answers an empty list for a cycle without timelines, and 404 for an unknown cycle', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);

    expect(await w.service.listByCycle(cycleId)).toEqual([]);
    expect(await refusal(w.service.listByCycle(999))).toBeInstanceOf(
      CycleNotFoundError,
    );
  });

  it('refuses the detail of an unknown timeline with 404', async () => {
    const w = world();

    expect(await refusal(w.service.detail(999))).toBeInstanceOf(
      TimelineNotFoundError,
    );
  });

  it('the detail is the timeline of the list plus `users`', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());

    const [listed] = await w.service.listByCycle(cycleId);
    const detail = await w.service.detail(timelineId);

    expect(detail).toEqual({ ...listed, users: [] });
  });

  it('counts only active assignments per role and drops NO_<ROLE>_ASSIGNED for a role that has one', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(
      w.ctx(),
      cycleId,
      request({ steps: [STEP_1, STEP_3] }),
    );
    expect((await w.service.get(timelineId)).readiness).toEqual([
      'NO_RESULTS_LOADED',
      'NO_ASSESSOR_ASSIGNED',
      'NO_LEAD_ASSESSOR_ASSIGNED',
    ]);

    // roles.id 3 = ASSESSOR (two active, one removed), 2 = LEAD_ASSESSOR (removed only)
    w.db.assignments.push(
      assignment(timelineId, 3),
      assignment(timelineId, 3),
      assignment(timelineId, 3, true),
      assignment(timelineId, 2, true),
    );
    const read = await w.service.get(timelineId);

    expect(read.assignedCount).toEqual({
      ASSESSOR: 2,
      LEAD_ASSESSOR: 0,
      TPB: 0,
      PPU: 0,
    });
    expect(read.readiness).toEqual([
      'NO_RESULTS_LOADED',
      'NO_LEAD_ASSESSOR_ASSIGNED',
    ]);
  });

  it('opens and closes by date through the clock alone, and a read writes nothing', async () => {
    const w = world();
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(w.ctx(), cycleId, request());
    const before = w.written();
    const history = [...w.db.history];

    const view = async () => {
      const t = await w.service.get(timelineId);
      return [t.status, t.currentStep, t.nextStep];
    };
    // The timeline has a load (DD-8): without one it would hold, not run.
    w.db.loads.markLoaded(timelineId);
    // 23:59 Rome on 6 Nov (CET, UTC+1)
    w.clock.advance(Date.parse('2026-11-06T22:59:00Z') - NOW.getTime());
    expect(await view()).toEqual(['live', 1, 2]);
    w.clock.advance(60_000); // 00:00 Rome, 7 Nov
    expect(await view()).toEqual(['live', null, 2]);
    w.clock.advance(
      Date.parse('2026-11-08T23:00:00Z') - Date.parse('2026-11-06T23:00:00Z'),
    ); // 00:00 Rome, 9 Nov
    expect(await view()).toEqual(['live', 2, null]);

    expect(w.written()).toBe(before);
    expect(w.db.history).toEqual(history);
  });
});

// FR-14 (assign: who qualifies, repeat, several roles, closed cycle), FR-15
// (remove keeps the row, re-assign), FR-13 (counts and readiness follow), NFR-3
// (the database key holds under concurrency), NFR-7 and design 6, 7.3, 7.4,
// DD-9, DD-10, as literals. Every user below holds OTHER roles than the one she
// is assigned in, or she is refused for a reason other than "has no role", so a
// check that only asks "has any live role" cannot pass these tests.
describe('assign and remove users (FR-14, FR-15, FR-13, DD-10)', () => {
  const AHEAD = [0, 1, 2, 3, 4, 5, 6, 7];
  const ASSESSOR: AssignUserCommand['role'] = 'ASSESSOR';

  // The writes log a decision line each; the decision-line tests below capture them.
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A timeline in the active cycle 2026 with an assessors and a lead assessors step; Ana: ASSESSOR + TPB, Bea: LEAD_ASSESSOR only, Cris: ASSESSOR + LEAD_ASSESSOR. */
  async function assigning() {
    const w = world();
    const cycleId = await w.seedCycle(2026, 'active');
    const { timelineId } = await w.service.create(
      w.ctx(),
      cycleId,
      request({ steps: [STEP_1, STEP_3] }),
    );
    const ana = await w.seedUser('Ana', [['ASSESSOR', 'KP'], ['TPB']]);
    const bea = await w.seedUser('Bea', [['LEAD_ASSESSOR', '*']]);
    const cris = await w.seedUser('Cris', [
      ['ASSESSOR', 'KP'],
      ['LEAD_ASSESSOR', '*'],
    ]);
    w.db.history.length = 0;
    const assign = (
      userId: number,
      role: AssignUserCommand['role'] = ASSESSOR,
      actorId = 7,
    ) => w.service.assign(w.ctx(actorId), timelineId, { userId, role });
    return { w, cycleId, timelineId, ana, bea, cris, assign };
  }

  /** The error is a 409 TIMELINES_USER_NOT_ELIGIBLE and says why, in `detail` (logs and tests only). */
  async function notEligible(promise: Promise<unknown>, detail: string) {
    const error = await refusal(promise);
    expect(error).toBeInstanceOf(TimelineUserNotEligibleError);
    expect(error).toMatchObject({ detail });
    expect((error as TimelineUserNotEligibleError).getStatus()).toBe(409);
  }

  describe('assign: who qualifies (FR-14)', () => {
    it('assigns a live ASSESSOR: the answer, the stored row, and a detail whose users, counts and readiness agree', async () => {
      const { w, timelineId, ana, assign } = await assigning();

      const result = await assign(ana.id);

      expect(result).toEqual({
        created: true,
        assignment: {
          assignmentId: 1,
          userId: ana.id,
          firstName: 'Ana',
          lastName: 'Tester',
          email: 'ana@cgiar.org',
          role: 'ASSESSOR',
          assignedAt: NOW,
        },
      });
      // roles.id 3 = ASSESSOR; `assigned_by` is the acting ADMIN (ctx 7).
      expect(w.db.assignments).toEqual([
        {
          id: 1,
          timelineId,
          userId: ana.id,
          roleId: 3,
          assignedAt: NOW,
          assignedBy: 7,
          removedAt: null,
          removedBy: null,
          activeKey: `${timelineId}:${ana.id}:3`,
        },
      ]);
      const detail = await w.service.detail(timelineId);
      expect(detail.users).toEqual([result.assignment]);
      expect(detail.assignedCount).toEqual({
        ASSESSOR: 1,
        LEAD_ASSESSOR: 0,
        TPB: 0,
        PPU: 0,
      });
      expect(detail.readiness).toEqual([
        'NO_RESULTS_LOADED',
        'NO_LEAD_ASSESSOR_ASSIGNED',
      ]);
      expect(w.db.history).toEqual(['assign:1']);
    });

    it('refuses an unknown user with 404 USERS_NOT_FOUND and writes nothing', async () => {
      const { w, assign } = await assigning();
      const before = w.written();

      const error = await refusal(assign(999));

      expect(error).toBeInstanceOf(UserNotFoundError);
      expect(error).toMatchObject({ response: { code: 'USERS_NOT_FOUND' } });
      expect(w.written()).toBe(before);
    });

    it('refuses an inactive user with 409, although she holds a live ASSESSOR grant and another role', async () => {
      const { w, assign } = await assigning();
      const dan = await w.seedUser('Dan', [['ASSESSOR', 'KP'], ['TPB']], {
        isActive: false,
      });
      const before = w.written();

      await notEligible(assign(dan.id), 'user_inactive');

      expect(w.written()).toBe(before);
    });

    it('refuses a user whose ASSESSOR grant was revoked, although she keeps a live TPB grant', async () => {
      const { w, ana, assign } = await assigning();
      const grant = w.db.base.assignments.find(
        (a) => a.userId === ana.id && a.roleId === w.roleId('ASSESSOR'),
      )!;
      expect(
        await w.db.base.stores.assignments.revoke(grant.id, 1, SEEDED_AT),
      ).toBe(true);
      const before = w.written();

      await notEligible(assign(ana.id), 'role_not_held');
      // The TPB grant she still holds is untouched and still qualifies her for TPB.
      expect((await assign(ana.id, 'TPB')).created).toBe(true);
      expect(w.written()).not.toBe(before);
    });

    it('refuses a grant that is flagged active but carries `revoked_at`: it is not live', async () => {
      const { w, ana, assign } = await assigning();
      const grant = w.db.base.assignments.find(
        (a) => a.userId === ana.id && a.roleId === w.roleId('ASSESSOR'),
      )!;
      grant.revokedAt = SEEDED_AT;
      grant.revokedBy = 1;
      expect(grant.isActive).toBe(true);
      const before = w.written();

      await notEligible(assign(ana.id), 'role_not_held');

      expect(w.written()).toBe(before);
    });

    it('refuses a grant of a role that was deactivated, and still accepts her live grant of another role', async () => {
      const { w, ana, assign } = await assigning();
      w.db.base.roles.find((r) => r.code === 'ASSESSOR')!.isActive = false;
      const before = w.written();

      await notEligible(assign(ana.id), 'role_not_held');
      expect(w.written()).toBe(before);
      expect((await assign(ana.id, 'TPB')).created).toBe(true);
    });

    it('refuses a role the user does not hold, whichever other roles she holds', async () => {
      const { w, ana, bea, assign } = await assigning();
      const before = w.written();

      // Bea holds LEAD_ASSESSOR only; Ana holds ASSESSOR and TPB, not PPU or LEAD_ASSESSOR.
      await notEligible(assign(bea.id, 'ASSESSOR'), 'role_not_held');
      await notEligible(assign(ana.id, 'PPU'), 'role_not_held');
      await notEligible(assign(ana.id, 'LEAD_ASSESSOR'), 'role_not_held');

      expect(w.written()).toBe(before);
    });

    it('accepts each of the four roles for a user who holds them all', async () => {
      const { w, timelineId, assign } = await assigning();
      const eve = await w.seedUser('Eve', [
        ['ASSESSOR', 'KP'],
        ['LEAD_ASSESSOR', '*'],
        ['TPB'],
        ['PPU'],
      ]);

      for (const role of ['ASSESSOR', 'LEAD_ASSESSOR', 'TPB', 'PPU'] as const) {
        expect((await assign(eve.id, role)).created).toBe(true);
      }

      expect((await w.service.get(timelineId)).assignedCount).toEqual({
        ASSESSOR: 1,
        LEAD_ASSESSOR: 1,
        TPB: 1,
        PPU: 1,
      });
    });

    it('refuses a role that the roles table does not know, with 409', async () => {
      const { w, ana, assign } = await assigning();
      w.db.roleCodeById.delete(3);

      await notEligible(assign(ana.id), 'role_unknown');
      expect(w.db.assignments).toEqual([]);
    });

    it('answers 404 for an unknown timeline before it looks at the user', async () => {
      const { w } = await assigning();

      expect(
        await refusal(
          w.service.assign(w.ctx(), 999, { userId: 999, role: 'ASSESSOR' }),
        ),
      ).toBeInstanceOf(TimelineNotFoundError);
    });

    it('refuses a closed cycle with 409 CYCLES_CLOSED before it looks at the user, and writes nothing', async () => {
      const { w, cycleId, ana, assign } = await assigning();
      await w.db.store.markClosed(cycleId, { by: 1, at: SEEDED_AT });
      const before = w.written();

      expect(await refusal(assign(ana.id))).toBeInstanceOf(CycleClosedError);
      expect(await refusal(assign(999))).toBeInstanceOf(CycleClosedError);

      expect(w.written()).toBe(before);
    });
  });

  describe('assign: repeat and several roles (FR-14, DD-10)', () => {
    it('a repeat answers the same assignment id with created=false, adds no row, and is refused by the database key', async () => {
      const { w, ana, assign } = await assigning();
      const first = await assign(ana.id);
      w.clock.advance(60_000);

      const again = await assign(ana.id);

      expect(again).toEqual({ created: false, assignment: first.assignment });
      expect(again.assignment.assignedAt).toEqual(NOW);
      expect(w.db.assignments).toHaveLength(1);
      expect(w.db.assignmentKeyViolations).toBe(1);
      expect(w.db.history).toEqual(['assign:1']);
    });

    it('the first answer, the repeat, the detail and the stored row carry the same second, whatever the milliseconds of the clock', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      // The clock reads 10:00:00.600. `assigned_at` keeps whole seconds, and the
      // fake rounds a fraction as MySQL does: a value stored with its
      // milliseconds would come back as 10:00:01 and differ from the answer.
      w.clock.advance(600);

      const first = await assign(ana.id);
      w.clock.advance(60_000);
      const again = await assign(ana.id);
      const detail = await w.service.detail(timelineId);

      expect(first.assignment.assignedAt).toEqual(NOW);
      expect(again.assignment.assignedAt).toEqual(first.assignment.assignedAt);
      expect(detail.users[0]!.assignedAt).toEqual(first.assignment.assignedAt);
      expect(w.db.assignments[0]!.assignedAt).toEqual(
        first.assignment.assignedAt,
      );
      expect(w.db.assignments).toHaveLength(1);
    });

    it('a repeat by a user who has since lost the role is refused with 409: eligibility is judged before the insert', async () => {
      const { w, ana, assign } = await assigning();
      await assign(ana.id);
      const grant = w.db.base.assignments.find(
        (a) => a.userId === ana.id && a.roleId === w.roleId('ASSESSOR'),
      )!;
      await w.db.base.stores.assignments.revoke(grant.id, 1, SEEDED_AT);

      await notEligible(assign(ana.id), 'role_not_held');

      expect(w.db.assignments).toHaveLength(1);
      expect(w.db.assignments[0]!.removedAt).toBeNull();
    });

    it('the same user as ASSESSOR and as LEAD_ASSESSOR is two entries, and two users in one role are two entries', async () => {
      const { w, timelineId, ana, cris, assign } = await assigning();

      const asAssessor = await assign(cris.id, 'ASSESSOR');
      const asLead = await assign(cris.id, 'LEAD_ASSESSOR');
      await assign(ana.id, 'ASSESSOR');

      expect(asAssessor.created && asLead.created).toBe(true);
      expect(asAssessor.assignment.assignmentId).not.toBe(
        asLead.assignment.assignmentId,
      );
      const detail = await w.service.detail(timelineId);
      expect(detail.users.map((u) => [u.userId, u.role])).toEqual([
        [cris.id, 'ASSESSOR'],
        [cris.id, 'LEAD_ASSESSOR'],
        [ana.id, 'ASSESSOR'],
      ]);
      expect(detail.assignedCount).toEqual({
        ASSESSOR: 2,
        LEAD_ASSESSOR: 1,
        TPB: 0,
        PPU: 0,
      });
      expect(detail.readiness).toEqual(['NO_RESULTS_LOADED']);
    });

    it('a repeat whose existing row is removed between the refusal and the read inserts again, once', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      const first = await assign(ana.id);
      let removedByRival = false;
      const racing: TimelinesUnitOfWork = {
        run: (work) =>
          w.unitOfWork.run((repositories) => {
            const t = repositories.timelines;
            const timelines = Object.create(t, {
              findActiveAssignment: {
                value: async (
                  ...args: Parameters<TimelinesStore['findActiveAssignment']>
                ) => {
                  if (removedByRival) return t.findActiveAssignment(...args);
                  removedByRival = true;
                  await t.removeAssignment({
                    timelineId,
                    assignmentId: first.assignment.assignmentId,
                    removedAt: NOW,
                    removedBy: 1,
                  });
                  return undefined;
                },
              },
            }) as TimelinesStore;
            return work({ ...repositories, timelines });
          }),
      };
      const service = new TimelinesService(
        racing,
        w.db.timelineStore,
        new CatalogService(w.resultTypeSource, w.programSource, () =>
          Date.now(),
        ),
        w.clock.now,
        w.db.loads,
      );

      const result = await service.assign(w.ctx(), timelineId, {
        userId: ana.id,
        role: 'ASSESSOR',
      });

      expect(result.created).toBe(true);
      expect(result.assignment.assignmentId).toBe(2);
      expect(w.db.assignments.map((a) => [a.id, a.removedAt !== null])).toEqual(
        [
          [1, true],
          [2, false],
        ],
      );
      expect(w.db.assignmentKeyViolations).toBe(1);
    });
  });

  describe('assign: two at once and an activation (NFR-3, DD-9, DD-10)', () => {
    it.each(AHEAD)(
      'two identical assigns started %i statements apart leave one active row, give both the same assignment id, and exactly one says created',
      async (ahead) => {
        const { w, timelineId, ana } = await assigning();
        const command: AssignUserCommand = { userId: ana.id, role: 'ASSESSOR' };

        const [a, b] = await staggered(
          () => w.service.assign(w.ctx(7), timelineId, command),
          ahead,
          () => w.instance().assign(w.ctx(8), timelineId, command),
        );

        expect([a.status, b.status]).toEqual(['fulfilled', 'fulfilled']);
        const answers = [a, b].map(
          (r) => (r as PromiseFulfilledResult<AssignResult>).value,
        );
        expect(answers.map((r) => r.assignment.assignmentId)).toEqual([1, 1]);
        expect(
          answers.map((r) => r.created).sort((x, y) => Number(x) - Number(y)),
        ).toEqual([false, true]);
        expect(
          w.db.assignments.filter((r) => r.removedAt === null),
        ).toHaveLength(1);
        expect(w.db.assignments).toHaveLength(1);
        expect(w.db.history).toEqual(['assign:1']);
        // The database key was the backstop that refused the second insert.
        expect(w.db.assignmentKeyViolations).toBe(1);
      },
    );

    const SWEEP = (['assign', 'activate'] as const).flatMap((first) =>
      AHEAD.map((ahead) => [first, ahead] as const),
    );
    const ACTIVATION = ['close:1', 'activate:2'];

    /** 2026 is active (id 1) and holds the timeline; 2027 is a draft (id 2) and its activation closes 2026. */
    async function raceWithActivation(
      first: 'assign' | 'activate',
      ahead: number,
    ) {
      const w = world();
      await w.seedCycle(2026, 'active');
      await w.seedCycle(2027);
      const { timelineId } = await w.service.create(w.ctx(), 1, request());
      const ana = await w.seedUser('Ana', [['ASSESSOR', 'KP'], ['TPB']]);
      w.db.history.length = 0;
      const assign = () =>
        w.service.assign(w.ctx(7), timelineId, {
          userId: ana.id,
          role: 'ASSESSOR',
        });
      const activate = () => w.cycles.activate(w.ctx(8), 2);
      const [assigned, activated] =
        first === 'assign'
          ? await staggered(assign, ahead, activate).then(
              ([a, b]) => [a, b] as const,
            )
          : await staggered(activate, ahead, assign).then(
              ([a, b]) => [b, a] as const,
            );
      return { w, assigned, activated };
    }

    it.each(SWEEP)(
      'an assign into the cycle that an activation closes, %s first and %i statements ahead: written before the close, or refused as closed, never written into a closed cycle',
      async (first, ahead) => {
        const { w, assigned, activated } = await raceWithActivation(
          first,
          ahead,
        );

        expect(activated.status).toBe('fulfilled');
        expect(w.db.cycles.map((c) => [c.year, c.status])).toEqual([
          [2026, 'closed'],
          [2027, 'active'],
        ]);
        if (assigned.status === 'fulfilled') {
          // Serial order: the assign, then the activation.
          expect(w.db.history).toEqual(['assign:1', ...ACTIVATION]);
          expect(w.db.assignments).toHaveLength(1);
        } else {
          // Serial order: the activation, then an assign that finds the cycle closed.
          expect(assigned.reason).toBeInstanceOf(CycleClosedError);
          expect(w.db.history).toEqual(ACTIVATION);
          expect(w.db.assignments).toEqual([]);
        }
      },
    );

    it('the sweep reaches both outcomes of an assign into the cycle that is being closed', async () => {
      const outcomes = new Set<string>();
      for (const [first, ahead] of SWEEP) {
        const { assigned } = await raceWithActivation(first, ahead);
        outcomes.add(assigned.status);
      }

      expect([...outcomes].sort()).toEqual(['fulfilled', 'rejected']);
    });
  });

  describe('remove (FR-15, FR-13)', () => {
    it('keeps the row with `removed_at` and `removed_by`, drops the count, and brings NO_ASSESSOR_ASSIGNED back', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      const { assignment } = await assign(ana.id);
      expect((await w.service.get(timelineId)).readiness).not.toContain(
        'NO_ASSESSOR_ASSIGNED',
      );
      w.clock.advance(60_000);

      await expect(
        w.service.remove(w.ctx(8), timelineId, assignment.assignmentId),
      ).resolves.toBeUndefined();

      expect(w.db.assignments).toHaveLength(1);
      expect(w.db.assignments[0]).toMatchObject({
        id: 1,
        assignedAt: NOW,
        assignedBy: 7,
        removedAt: new Date(NOW.getTime() + 60_000),
        removedBy: 8,
        activeKey: null,
      });
      const detail = await w.service.detail(timelineId);
      expect(detail.users).toEqual([]);
      expect(detail.assignedCount.ASSESSOR).toBe(0);
      expect(detail.readiness).toEqual([
        'NO_RESULTS_LOADED',
        'NO_ASSESSOR_ASSIGNED',
        'NO_LEAD_ASSESSOR_ASSIGNED',
      ]);
      expect(w.db.history).toEqual(['assign:1', 'remove:1']);
    });

    it('a second remove of the same assignment is 404 TIMELINES_ASSIGNMENT_NOT_FOUND and leaves the first removal as it was', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      const { assignment } = await assign(ana.id);
      await w.service.remove(w.ctx(8), timelineId, assignment.assignmentId);
      const before = w.written();

      const error = await refusal(
        w.service.remove(w.ctx(9), timelineId, assignment.assignmentId),
      );

      expect(error).toBeInstanceOf(TimelineAssignmentNotFoundError);
      expect(error).toMatchObject({
        response: { code: 'TIMELINES_ASSIGNMENT_NOT_FOUND' },
      });
      expect(w.written()).toBe(before);
      expect(w.db.assignments[0]!.removedBy).toBe(8);
    });

    it('an assignment of another timeline, or one that does not exist, is 404 and nothing is removed', async () => {
      const { w, cycleId, timelineId, ana, assign } = await assigning();
      const other = await w.service.create(
        w.ctx(),
        cycleId,
        request({ name: 'Other timeline' }),
      );
      const onOther = await w.service.assign(w.ctx(), other.timelineId, {
        userId: ana.id,
        role: 'ASSESSOR',
      });
      await assign(ana.id);
      const before = w.written();

      expect(
        await refusal(
          w.service.remove(
            w.ctx(),
            timelineId,
            onOther.assignment.assignmentId,
          ),
        ),
      ).toBeInstanceOf(TimelineAssignmentNotFoundError);
      expect(
        await refusal(w.service.remove(w.ctx(), timelineId, 999)),
      ).toBeInstanceOf(TimelineAssignmentNotFoundError);
      expect(await refusal(w.service.remove(w.ctx(), 999, 1))).toBeInstanceOf(
        TimelineNotFoundError,
      );

      expect(w.written()).toBe(before);
      expect(w.db.assignments.every((a) => a.removedAt === null)).toBe(true);
    });

    it('refuses a closed cycle with 409 CYCLES_CLOSED and keeps the assignment active', async () => {
      const { w, cycleId, timelineId, ana, assign } = await assigning();
      const { assignment } = await assign(ana.id);
      await w.db.store.markClosed(cycleId, { by: 1, at: SEEDED_AT });
      const before = w.written();

      expect(
        await refusal(
          w.service.remove(w.ctx(), timelineId, assignment.assignmentId),
        ),
      ).toBeInstanceOf(CycleClosedError);

      expect(w.written()).toBe(before);
      expect(w.db.assignments[0]!.removedAt).toBeNull();
    });

    it.each(AHEAD)(
      'two removes started %i statements apart give one success and one 404, and the row is removed once',
      async (ahead) => {
        const { w, timelineId, ana, assign } = await assigning();
        const { assignment } = await assign(ana.id);
        w.db.history.length = 0;

        const [a, b] = await staggered(
          () => w.service.remove(w.ctx(8), timelineId, assignment.assignmentId),
          ahead,
          () =>
            w.instance().remove(w.ctx(9), timelineId, assignment.assignmentId),
        );

        expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
        const loser = a.status === 'rejected' ? a : (b as typeof a);
        expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(
          TimelineAssignmentNotFoundError,
        );
        expect(w.db.assignments).toHaveLength(1);
        expect(w.db.assignments[0]!.removedBy).toBe(
          a.status === 'fulfilled' ? 8 : 9,
        );
        expect(w.db.history).toEqual(['remove:1']);
      },
    );

    it('a re-assign after a removal is a new active row next to the removed one, and the database key never fired', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      const first = await assign(ana.id);
      await w.service.remove(
        w.ctx(8),
        timelineId,
        first.assignment.assignmentId,
      );

      const again = await assign(ana.id);

      expect(again.created).toBe(true);
      expect(again.assignment.assignmentId).toBe(2);
      expect(w.db.assignments.map((a) => [a.id, a.removedAt !== null])).toEqual(
        [
          [1, true],
          [2, false],
        ],
      );
      expect(w.db.assignmentKeyViolations).toBe(0);
      const detail = await w.service.detail(timelineId);
      expect(detail.users.map((u) => u.assignmentId)).toEqual([2]);
      expect(detail.assignedCount.ASSESSOR).toBe(1);
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

    it('an assign, a repeat and a remove each write one ok line with the assignment id, and never a name or an email', async () => {
      const { w, timelineId, ana, assign } = await assigning();
      lines.length = 0;

      const { assignment } = await assign(ana.id);
      await assign(ana.id);
      await w.service.remove(w.ctx(), timelineId, assignment.assignmentId);

      expect(lines).toEqual([
        {
          level: 'log',
          line: {
            ...base,
            action: 'timeline_user_assign',
            targetId: 1,
            outcome: 'ok',
          },
        },
        {
          level: 'log',
          line: {
            ...base,
            action: 'timeline_user_assign',
            targetId: 1,
            outcome: 'ok',
          },
        },
        {
          level: 'log',
          line: {
            ...base,
            action: 'timeline_user_remove',
            targetId: 1,
            outcome: 'ok',
          },
        },
      ]);
      expect(JSON.stringify(lines)).not.toMatch(/Ana|Tester|cgiar\.org/);
    });

    it('a refused assign and a refused remove each write one warn line with the catalog code and no target', async () => {
      const { w, timelineId, bea, assign } = await assigning();
      lines.length = 0;

      await refusal(assign(bea.id, 'ASSESSOR'));
      await refusal(w.service.remove(w.ctx(), timelineId, 999));

      expect(lines).toEqual([
        {
          level: 'warn',
          line: {
            ...base,
            action: 'timeline_user_assign',
            targetId: null,
            outcome: 'refused',
            reason: 'TIMELINES_USER_NOT_ELIGIBLE',
          },
        },
        {
          level: 'warn',
          line: {
            ...base,
            action: 'timeline_user_remove',
            targetId: null,
            outcome: 'refused',
            reason: 'TIMELINES_ASSIGNMENT_NOT_FOUND',
          },
        },
      ]);
      expect(JSON.stringify(lines)).not.toMatch(/Bea|Tester|cgiar\.org/);
    });
  });
});

// timeline-edit, `TimelinesService.update` (T-5): FR-1, FR-4, FR-5, FR-7 to
// FR-12, NFR-5, NFR-7 and design 6 (answer order), 7.2 (the flow), 7.5 (the
// line), DD-6 and DD-11, as literals. Every refusal is asserted twice: the
// answer, and that nothing was written (no row, no statement, no audit row).
// The fixture timeline has three steps, and today is 2026-10-20 in Rome, so
// step 1 (2026-11-02 to 2026-11-06) is upcoming; `startStepTwo` walks the clock
// to 2026-11-10 with a load: step 1 closed, step 2 in progress, step 3 upcoming.
describe('update: the edit flow (timeline-edit design 6, 7.2)', () => {
  type EditWorld = ReturnType<typeof world>;
  const DAY = 86_400_000;

  /** The cycle and a timeline of "all programs, all result types" (no catalog read at create) with three steps. */
  async function seeded(
    w: EditWorld,
    over: Partial<CreateTimelineCommand> = {},
  ) {
    const cycleId = await w.seedCycle(2026);
    const { timelineId } = await w.service.create(
      w.ctx(),
      cycleId,
      request({
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
        steps: [STEP_1, STEP_2, STEP_3],
        ...over,
      }),
    );
    return { cycleId, timelineId };
  }

  /** 2026-11-10 in Rome, with a load: step 1 is closed, step 2 in progress (closes 2026-11-13), step 3 upcoming. */
  function startStepTwo(w: EditWorld, timelineId: number): void {
    w.clock.advance(21 * DAY);
    w.db.loads.markLoaded(timelineId);
  }

  const edit = (
    w: EditWorld,
    timelineId: number,
    body: Partial<UpdateTimelineCommand> = {},
    ctx: AdminConfigContext = w.ctx(),
  ) => w.service.update(ctx, timelineId, { version: 1, ...body });

  /** A reserved `Idempotency-Key` as the interceptor leaves it: the context an edit runs with, and the store to inspect. */
  async function keyed(w: EditWorld) {
    const store = w.db.base.idempotencyStore(w.clock.now);
    const reserved = await store.reserve({
      actorId: 7,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 200,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');
    const ctx: AdminConfigContext = {
      actorId: 7,
      requestId: 'req-1',
      idempotency: { reservation: reserved.reservation, outcome: 'none' },
    };
    return { store, ctx };
  }

  /**
   * Runs a request that must be refused and proves it wrote nothing: not a
   * timeline, step or scope row, not one write statement (the log keeps
   * rolled-back ones), not an audit row. `transaction` says whether the
   * refusal comes before the transaction opens (none begun) or inside it (one
   * begun and rolled back).
   */
  async function refusedWithNoWrites(
    w: EditWorld,
    run: () => Promise<unknown>,
    transaction: 'none' | 'rolled_back',
  ): Promise<unknown> {
    const before = w.written();
    const audit = structuredClone(w.db.auditEvents);
    const begun = w.unitOfWork.begun;
    const rolledBack = w.unitOfWork.rolledBack;
    const error = await refusal(run());
    expect(w.written()).toBe(before);
    expect(w.db.auditEvents).toEqual(audit);
    expect(w.unitOfWork.begun).toBe(begun + (transaction === 'none' ? 0 : 1));
    expect(w.unitOfWork.rolledBack).toBe(
      rolledBack + (transaction === 'none' ? 0 : 1),
    );
    return error;
  }

  /** A loads port that runs one `rival` action between the unlocked reads and the transaction (a lost race, design 7.2 step 8). */
  function rivalLoads() {
    let rival: (() => Promise<unknown>) | undefined;
    return {
      loads: (db: InMemoryAdminConfigDatabase): TimelineLoads => ({
        withLoad: async (ids) => {
          const run = rival;
          rival = undefined;
          await run?.();
          return db.loads.withLoad(ids);
        },
      }),
      onNextRead: (run: () => Promise<unknown>) => {
        rival = run;
      },
    };
  }

  /**
   * A mixed read made deterministic (bugfix/timeline-edit-noop-stale DD-2): a
   * service over a store whose `findBundle` reads the row, lets `rival` commit
   * a whole edit through another instance (its own transaction, version + 1),
   * and only then reads the steps and the scope, in the adapter's order (the
   * row first: `findBundle` in `timelines.store.ts`). The request holds the OLD
   * row and the NEW steps, which is what an edit that commits between two of
   * the four statements leaves. The fake's own `findBundle` is not touched.
   * The request's unit of work is its own, so `begun` counts its transactions
   * only.
   */
  function mixedRead(w: EditWorld, rival: UpdateTimelineCommand) {
    const unitOfWork = new InMemoryTimelinesUnitOfWork(w.db);
    const real = w.db.timelineStore;
    let afterRival: string | undefined;
    const store = Object.assign(Object.create(real), {
      findBundle: async (id: number) => {
        const timeline = await real.findById(id);
        if (!timeline) return undefined;
        await w.instance().update(w.ctx(8), id, rival);
        afterRival = w.written();
        const steps = await real.listSteps([id]);
        const programs = await real.listPrograms([id]);
        const resultTypes = await real.listResultTypes([id]);
        return {
          timeline,
          steps,
          programIds: programs.map((row) => row.programId),
          resultTypeKeys: resultTypes.map((row) => row.resultTypeKey),
        };
      },
    }) as TimelinesStore;
    return {
      service: new TimelinesService(
        unitOfWork,
        store,
        w.catalogs,
        w.clock.now,
        w.db.loads,
      ),
      unitOfWork,
      /** The rows and write statements as the rival left them: the request must add none. */
      afterRival: () => afterRival,
    };
  }

  describe('what an applied edit does (FR-1, FR-7, FR-10)', () => {
    it('extends step 1: its closing date changes, every other field keeps its value, and the answer is the timeline as read with the new version (FR-1)', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const before = await w.service.get(timelineId);
      const writes = w.db.timelineWriteLog.length;

      const answer = await edit(w, timelineId, {
        steps: [{ position: 1, closesOn: '2026-11-07' }],
      });

      expect(answer).toEqual({
        ...before,
        version: 2,
        steps: before.steps.map((step) =>
          step.position === 1 ? { ...step, closesOn: '2026-11-07' } : step,
        ),
      });
      expect(await w.service.get(timelineId)).toEqual(answer);
      expect(w.db.timelineWriteLog.slice(writes)).toEqual([
        'timeline:update:1',
        'step:update:1:1',
        'audit:1',
      ]);
      expect(w.db.timelines[0]).toMatchObject({
        version: 2,
        updatedBy: 7,
        updatedAt: NOW,
      });
    });

    it('writes ONE audit row for a name and a closing date, with the changed fields only, before and after, steps by position (FR-10)', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      await edit(w, timelineId, {
        name: '  Renamed ',
        steps: [
          { position: 2, closesOn: '2026-11-12', name: STEP_2.name },
          { position: 3, opensOn: STEP_3.opensOn },
        ],
      });

      expect(w.db.auditEvents).toHaveLength(1);
      expect(w.db.auditEvents[0]).toMatchObject({
        timelineId,
        actorId: 7,
        action: 'update',
        requestId: 'req-1',
        createdAt: NOW,
      });
      expect(w.db.auditEvents[0]!.changes).toEqual({
        name: { before: 'July 2026', after: 'Renamed' },
        'steps.2.closesOn': { before: '2026-11-13', after: '2026-11-12' },
      });
    });

    it('moves an in-progress step closing date and every read after shows it in progress until then, with no stored status (FR-7)', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);

      const answer = await edit(w, timelineId, {
        confirmInProgress: true,
        steps: [{ position: 2, closesOn: '2026-11-15' }],
      });

      expect(answer).toMatchObject({
        status: 'live',
        currentStep: 2,
        version: 2,
      });
      expect(answer.steps.map((step) => step.state)).toEqual([
        'closed',
        'in_progress',
        'upcoming',
      ]);
      // A later read, a day later, still has it open: only dates are stored.
      w.clock.advance(3 * DAY);
      expect(await w.service.get(timelineId)).toMatchObject({
        status: 'live',
        currentStep: 2,
      });
      expect(Object.keys(w.db.timelines[0]!)).not.toContain('status');
    });
  });

  describe('the scope (FR-4)', () => {
    it('changing the programs to an explicit list reads the programs catalog only, replaces the rows and audits the flag and the list', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const programs = vi.spyOn(w.catalogs, 'listSciencePrograms');
      const resultTypes = vi.spyOn(w.catalogs, 'listResultTypes');

      await edit(w, timelineId, { allPrograms: false, programIds: [2, 1] });

      expect(programs).toHaveBeenCalledTimes(1);
      expect(resultTypes).not.toHaveBeenCalled();
      expect(
        w.db.programs.map((row) => row.programId).sort((a, b) => a - b),
      ).toEqual([1, 2]);
      expect(w.db.timelines[0]).toMatchObject({ allPrograms: false });
      expect(w.db.auditEvents[0]!.changes).toEqual({
        allPrograms: { before: true, after: false },
        programIds: { before: [], after: [1, 2] },
      });
    });

    it('turning an explicit list into "all" reads no catalog and deletes the rows', async () => {
      const w = world();
      const { timelineId } = await seeded(w, {
        allPrograms: false,
        programIds: [1, 2],
      });
      const programs = vi.spyOn(w.catalogs, 'listSciencePrograms');

      await edit(w, timelineId, { allPrograms: true });

      expect(programs).not.toHaveBeenCalled();
      expect(w.db.programs).toEqual([]);
      expect(w.db.timelines[0]).toMatchObject({ allPrograms: true });
    });

    it('a list the catalog does not know is one 400 on its path, and nothing is written', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { allPrograms: false, programIds: [99] }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineValidationError);
      expect((error as TimelineValidationError).issues).toEqual([
        { field: 'programIds', code: 'INVALID' },
      ]);
    });

    it('a timeline with a load refuses a scope change through the same "has a load" source as the hold (FR-4)', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      w.db.loads.markLoaded(timelineId);

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { allPrograms: false, programIds: [1] }),
        'none',
      );

      expect((error as TimelineValidationError).issues).toEqual([
        { field: 'programIds', code: 'LOCKED' },
      ]);
    });
  });

  describe('the catalogs are read only for an explicit list that changes (design 7.2 step 4)', () => {
    it('a name and a date edit works while both catalogs are down, and asks neither', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      w.programSource.list.mockRejectedValue(new UpstreamUnavailableError());
      w.resultTypeSource.list.mockRejectedValue(new UpstreamUnavailableError());
      const programs = vi.spyOn(w.catalogs, 'listSciencePrograms');
      const resultTypes = vi.spyOn(w.catalogs, 'listResultTypes');

      const answer = await edit(w, timelineId, {
        name: 'Renamed',
        steps: [{ position: 1, closesOn: '2026-11-07' }],
      });

      expect(answer).toMatchObject({ name: 'Renamed', version: 2 });
      expect(programs).not.toHaveBeenCalled();
      expect(resultTypes).not.toHaveBeenCalled();
    });

    it('an explicit list sent again as it is stored is not a change and asks no catalog', async () => {
      const w = world();
      const { timelineId } = await seeded(w, {
        allPrograms: false,
        programIds: [1, 2],
        allResultTypes: false,
        resultTypeKeys: ['KP'],
      });
      const programs = vi.spyOn(w.catalogs, 'listSciencePrograms');
      const resultTypes = vi.spyOn(w.catalogs, 'listResultTypes');

      await edit(w, timelineId, {
        name: 'Renamed',
        allPrograms: false,
        programIds: [2, 1],
        allResultTypes: false,
        resultTypeKeys: ['KP'],
      });

      expect(programs).not.toHaveBeenCalled();
      expect(resultTypes).not.toHaveBeenCalled();
    });

    it.each([
      [
        'programs',
        { allPrograms: false, programIds: [1] },
        (w: EditWorld) =>
          w.programSource.list.mockRejectedValue(
            new UpstreamUnavailableError(),
          ),
      ],
      [
        'result types',
        { allResultTypes: false, resultTypeKeys: ['KP'] },
        (w: EditWorld) =>
          w.resultTypeSource.list.mockRejectedValue(
            new UpstreamUnavailableError(),
          ),
      ],
    ])(
      'a changed %s list with that catalog unreachable is 503 and writes nothing',
      async (_label, body, breakCatalog) => {
        const w = world();
        const { timelineId } = await seeded(w);
        breakCatalog(w);

        const error = await refusedWithNoWrites(
          w,
          () => edit(w, timelineId, body),
          'none',
        );

        expect(error).toBeInstanceOf(UpstreamUnavailableError);
      },
    );
  });

  describe('the answer order, one case per step, each with a request that would also fail every later step (design 6)', () => {
    it('1. an unknown timeline is 404, before a wrong version or a bad name', async () => {
      const w = world();
      await seeded(w);

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, 99, { version: 9, name: '' }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineNotFoundError);
    });

    it('2. a closed cycle is 409 CYCLES_CLOSED, before a wrong version or a bad name', async () => {
      const w = world();
      const { cycleId, timelineId } = await seeded(w);
      await w.db.store.markActive(cycleId, { by: 1, at: SEEDED_AT });
      await w.db.store.markClosed(cycleId, { by: 1, at: SEEDED_AT });

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { version: 9, name: '' }),
        'none',
      );

      expect(error).toBeInstanceOf(CycleClosedError);
    });

    it('3. a stale version is 409 before any catalog is read, a bad name or a bad list', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      w.programSource.list.mockRejectedValue(new UpstreamUnavailableError());
      const programs = vi.spyOn(w.catalogs, 'listSciencePrograms');

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            version: 9,
            name: '',
            allPrograms: false,
            programIds: [1],
          }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineVersionStaleError);
      expect(programs).not.toHaveBeenCalled();
    });

    it('4. an unreachable catalog is 503 before any rule is judged', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      w.programSource.list.mockRejectedValue(new UpstreamUnavailableError());

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            name: '',
            allPrograms: false,
            programIds: [1],
          }),
        'none',
      );

      expect(error).toBeInstanceOf(UpstreamUnavailableError);
    });

    it('5. a rule problem is one 400, before the in-progress confirmation (DD-11)', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);

      // Changes an in-progress step without the confirmation AND has a bad name.
      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            name: '',
            steps: [{ position: 2, closesOn: '2026-11-15' }],
          }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineValidationError);
      expect((error as TimelineValidationError).issues).toEqual([
        { field: 'name', code: 'REQUIRED' },
      ]);
    });

    it('6. an unconfirmed in-progress change is 409, before the write that would find the name taken', async () => {
      const w = world();
      const { cycleId, timelineId } = await seeded(w);
      await w.service.create(
        w.ctx(),
        cycleId,
        request({
          name: 'Other',
          allPrograms: true,
          programIds: [],
          allResultTypes: true,
          resultTypeKeys: [],
        }),
      );
      startStepTwo(w, timelineId);
      const body = {
        name: 'other',
        steps: [{ position: 2, closesOn: '2026-11-15' }],
      };

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, body),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineInProgressUnconfirmedError);
      // The same request, confirmed, reaches the write and finds the name taken.
      const confirmed = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { ...body, confirmInProgress: true }),
        'rolled_back',
      );
      expect(confirmed).toBeInstanceOf(TimelineNameTakenError);
    });

    it('7. a no-op answers the timeline as stored: no write, no version change, no audit row, no transaction (FR-11)', async () => {
      const w = world();
      const { timelineId } = await seeded(w, {
        allPrograms: false,
        programIds: [1, 2],
      });
      const before = await w.service.get(timelineId);
      const written = w.written();
      const begun = w.unitOfWork.begun;

      // Every field of the drawer, equal to what is stored (text trimmed, a list in another order).
      const answer = await edit(w, timelineId, {
        name: ' July 2026 ',
        allPrograms: false,
        programIds: [2, 1],
        allResultTypes: true,
        steps: before.steps.map((step) => ({
          position: step.position,
          name: step.name,
          opensOn: step.opensOn,
          closesOn: step.closesOn,
        })),
      });

      expect(answer).toEqual(before);
      expect(answer.version).toBe(1);
      expect(w.written()).toBe(written);
      expect(w.db.auditEvents).toEqual([]);
      expect(w.unitOfWork.begun).toBe(begun);
    });

    it('7. a no-op with a stale version is still 409: the version is checked before the no-op test', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { version: 4, name: 'July 2026' }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineVersionStaleError);
    });

    it('8. a taken name, in any letter case, is 409 at the write and nothing of the request is applied (FR-5)', async () => {
      const w = world();
      const { cycleId, timelineId } = await seeded(w);
      await w.service.create(
        w.ctx(),
        cycleId,
        request({
          name: 'Other',
          allPrograms: true,
          programIds: [],
          allResultTypes: true,
          resultTypeKeys: [],
        }),
      );

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            name: 'OTHER',
            allPrograms: false,
            programIds: [1],
            steps: [{ position: 1, closesOn: '2026-11-07' }],
          }),
        'rolled_back',
      );

      expect(error).toBeInstanceOf(TimelineNameTakenError);
      expect(w.db.timelines[0]).toMatchObject({
        name: 'July 2026',
        version: 1,
        allPrograms: true,
      });
    });
  });

  describe('a race lost inside the transaction (FR-9, FR-12, DD-6)', () => {
    it('an edit committed after the unlocked reads makes the locked re-check 409 stale: the loser writes nothing and the winner stays', async () => {
      const hook = rivalLoads();
      const w = world({ loads: hook.loads });
      const { timelineId } = await seeded(w);
      let afterWinner = '';
      hook.onNextRead(async () => {
        await w.instance().update(w.ctx(8), timelineId, {
          version: 1,
          name: 'First',
        });
        afterWinner = w.written();
      });

      const lost = edit(w, timelineId, {
        name: 'Second',
        steps: [{ position: 1, closesOn: '2026-11-07' }],
      });
      const error = await refusal(lost);

      expect(error).toBeInstanceOf(TimelineVersionStaleError);
      // Only the winner's rows: its own update and its one audit row.
      expect(w.db.timelines[0]).toMatchObject({ name: 'First', version: 2 });
      expect(
        w.db.steps.find((s) => s.position === 1 && s.timelineId === timelineId),
      ).toMatchObject({ closesAt: `${STEP_1.closesOn}T23:59` });
      expect(w.db.auditEvents).toHaveLength(1);
      expect(w.db.auditEvents[0]).toMatchObject({ actorId: 8 });
      expect(w.unitOfWork.rolledBack).toBe(1);
      // Nothing of the loser's request was written after the winner committed.
      expect(w.written()).toBe(afterWinner);
    });

    it('the conditional UPDATE refusing the version (0 rows) is thrown as 409 stale inside the transaction: nothing after it runs and the key mark rolls back', async () => {
      const w = world({
        unitOfWork: (base) => ({
          run: (work) =>
            base.run((repositories) =>
              work({
                ...repositories,
                timelines: Object.assign(
                  Object.create(repositories.timelines),
                  {
                    updateTimeline: async () => ({ kind: 'stale' as const }),
                  },
                ) as TimelinesStore,
              }),
            ),
        }),
      });
      const { timelineId } = await seeded(w);
      const { store, ctx } = await keyed(w);

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { name: 'Renamed' }, ctx),
        'rolled_back',
      );

      expect(error).toBeInstanceOf(TimelineVersionStaleError);
      expect(store.peek(7, 'key-1')).toMatchObject({ state: 'in_progress' });
    });

    it('a cycle closed after the unlocked reads is 409 CYCLES_CLOSED at the locked re-check, and nothing is written', async () => {
      const hook = rivalLoads();
      const w = world({ loads: hook.loads });
      const { cycleId, timelineId } = await seeded(w);
      hook.onNextRead(async () => {
        await w.db.store.markActive(cycleId, { by: 1, at: SEEDED_AT });
        await w.db.store.markClosed(cycleId, { by: 1, at: SEEDED_AT });
      });

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, { name: 'Renamed' }),
        'rolled_back',
      );

      expect(error).toBeInstanceOf(CycleClosedError);
    });
  });

  // bugfix/timeline-edit-noop-stale FR-1: an edit committed between the row
  // read and the steps read leaves the request with the old row (version 1, so
  // the early check passes) and the new steps. Each unlocked answer must still
  // be 409 stale. The three tests read step 3 of the fixture (2026-11-16 to
  // 2026-11-20); the rival edits it, and the request, judged against the
  // rival's steps, would be a no-op, a 400 or a confirmation question.
  describe('a stale edit on a mixed read (bugfix/timeline-edit-noop-stale FR-1, DD-2)', () => {
    /** The rival committed (version 2, its ONE audit row, actor 8) and the request wrote nothing after it, not even a transaction. */
    function expectOnlyTheRival(
      w: EditWorld,
      mixed: ReturnType<typeof mixedRead>,
    ): void {
      expect(w.db.timelines[0]).toMatchObject({ version: 2 });
      expect(w.db.auditEvents).toHaveLength(1);
      expect(w.db.auditEvents[0]).toMatchObject({ actorId: 8 });
      expect(w.written()).toBe(mixed.afterRival());
      expect(mixed.unitOfWork.begun).toBe(0);
    }

    it('no-op on a mixed read: the rival committed the identical edit after the row was read, so the answer is 409 stale, not a 200, and there is no second audit row', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const body = {
        version: 1,
        steps: [{ position: 3, closesOn: '2026-11-27' }],
      };
      const mixed = mixedRead(w, body);

      await expect(
        mixed.service.update(w.ctx(7), timelineId, body),
      ).rejects.toBeInstanceOf(TimelineVersionStaleError);

      expectOnlyTheRival(w, mixed);
      expect(
        w.db.steps.find((s) => s.timelineId === timelineId && s.position === 3),
      ).toMatchObject({ closesAt: '2026-11-27T23:59' });
    });

    it('400 on a mixed read: values that break a rule only against the rival steps are 409 stale, not VALIDATION_FAILED, and nothing is written', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      // Step 3 now opens on 2026-11-18, so a closing day of 2026-11-17 is a
      // 400 against it; against the steps the request read (opens 2026-11-16)
      // it is valid.
      const mixed = mixedRead(w, {
        version: 1,
        steps: [{ position: 3, opensOn: '2026-11-18' }],
      });

      await expect(
        mixed.service.update(w.ctx(7), timelineId, {
          version: 1,
          steps: [{ position: 3, closesOn: '2026-11-17' }],
        }),
      ).rejects.toBeInstanceOf(TimelineVersionStaleError);

      expectOnlyTheRival(w, mixed);
      expect(
        w.db.steps.find((s) => s.timelineId === timelineId && s.position === 3),
      ).toMatchObject({
        opensAt: '2026-11-18T00:00',
        closesAt: `${STEP_3.closesOn}T23:59`,
      });
    });

    it('unconfirmed on a mixed read: a step that is in progress only in the rival steps is 409 stale, not TIMELINES_IN_PROGRESS_UNCONFIRMED, and nothing is written', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      // `startStepTwo` (2026-11-10, with a load), then the clock goes to 00:00
      // Rome on 2026-11-14: steps 1 and 2 are closed and step 3 (opens
      // 2026-11-16) is upcoming, so nothing is in progress and a closing-day
      // change asks for no confirmation.
      startStepTwo(w, timelineId);
      w.clock.advance(
        Date.parse('2026-11-13T23:00:00Z') - w.clock.now().getTime(),
      );
      // The rival opens step 3 at that minute (an upcoming step may open at the
      // current minute, not before it, S-4): in its steps step 3 is in
      // progress, so a request that moves its closing day needs the
      // confirmation it did not send.
      const mixed = mixedRead(w, {
        version: 1,
        steps: [{ position: 3, opensOn: '2026-11-14' }],
      });

      await expect(
        mixed.service.update(w.ctx(7), timelineId, {
          version: 1,
          steps: [{ position: 3, closesOn: '2026-11-21' }],
        }),
      ).rejects.toBeInstanceOf(TimelineVersionStaleError);

      expectOnlyTheRival(w, mixed);
      expect(
        w.db.steps.find((s) => s.timelineId === timelineId && s.position === 3),
      ).toMatchObject({
        opensAt: '2026-11-14T00:00',
        closesAt: `${STEP_3.closesOn}T23:59`,
      });
    });
  });

  describe('the in-progress confirmation (FR-8)', () => {
    it('an in-progress change is refused without confirmation, and saved with it', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);
      const body = { steps: [{ position: 2, closesOn: '2026-11-15' }] };

      const error = await refusedWithNoWrites(
        w,
        () => edit(w, timelineId, body),
        'none',
      );
      expect(error).toBeInstanceOf(TimelineInProgressUnconfirmedError);

      const answer = await edit(w, timelineId, {
        ...body,
        confirmInProgress: true,
      });
      expect(answer.version).toBe(2);
      expect(answer.steps[1]).toMatchObject({ closesOn: '2026-11-15' });
      expect(w.db.auditEvents).toHaveLength(1);
      // The confirmation is not a field of the timeline: it is not audited.
      expect(Object.keys(w.db.auditEvents[0]!.changes)).toEqual([
        'steps.2.closesOn',
      ]);
    });

    it('the name of an in-progress step needs the confirmation too: any field of that step does', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            steps: [{ position: 2, name: 'Renamed step' }],
          }),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineInProgressUnconfirmedError);
    });

    it('the timeline name, a closed step name and an upcoming step name need none, and a confirmation sent anyway is accepted and ignored', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);

      const first = await edit(w, timelineId, {
        name: 'Renamed',
        steps: [
          { position: 1, name: 'Closed step renamed' },
          { position: 3, name: 'Upcoming step renamed' },
        ],
      });
      const second = await edit(w, timelineId, {
        version: 2,
        confirmInProgress: true,
        name: 'Renamed again',
      });

      expect(first.version).toBe(2);
      expect(second).toMatchObject({ version: 3, name: 'Renamed again' });
      expect(w.db.auditEvents.map((row) => Object.keys(row.changes))).toEqual([
        ['name', 'steps.1.name', 'steps.3.name'],
        ['name'],
      ]);
    });
  });

  describe('every problem at once (FR-5)', () => {
    it('an empty name, a closed step date and a scope change after step 1 started are three issues in one 400', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      startStepTwo(w, timelineId);

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            name: '',
            allPrograms: false,
            programIds: [1],
            steps: [{ position: 1, closesOn: '2026-11-05' }],
          }),
        'none',
      );

      expect((error as TimelineValidationError).issues).toEqual([
        { field: 'name', code: 'REQUIRED' },
        { field: 'steps[0].closesOn', code: 'LOCKED' },
        { field: 'programIds', code: 'LOCKED' },
      ]);
    });

    it('moving step 1 closing date over step 2 names step 2 even though only step 1 was sent', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(w, timelineId, {
            steps: [{ position: 1, closesOn: '2026-11-12' }],
          }),
        'none',
      );

      expect((error as TimelineValidationError).issues).toEqual([
        { field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' },
      ]);
    });
  });

  describe('two admins (FR-9, NFR-3)', () => {
    it('Ana saves on version 1, then Luis saves on version 1: Luis gets 409 stale and his edit is not merged into hers', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      await edit(w, timelineId, { name: 'Ana name' }, w.ctx(7));
      const error = await refusedWithNoWrites(
        w,
        () =>
          edit(
            w,
            timelineId,
            { steps: [{ position: 1, closesOn: '2026-11-07' }] },
            w.ctx(8),
          ),
        'none',
      );

      expect(error).toBeInstanceOf(TimelineVersionStaleError);
      expect(w.db.timelines[0]).toMatchObject({ name: 'Ana name', version: 2 });
      expect(w.db.auditEvents).toHaveLength(1);
    });

    it.each(Array.from({ length: 21 }, (_, ahead) => [ahead]))(
      'both at the same version, the second one starting %i statements after the first: exactly one applies and the other is 409 stale',
      async (ahead) => {
        const w = world();
        const { timelineId } = await seeded(w);
        const other = w.instance();

        const outcomes = await staggered(
          () => edit(w, timelineId, { name: 'Ana name' }, w.ctx(7)),
          ahead,
          () =>
            other.update(w.ctx(8), timelineId, {
              version: 1,
              steps: [{ position: 1, closesOn: '2026-11-07' }],
            }),
        );

        expect(
          outcomes.filter((outcome) => outcome.status === 'fulfilled'),
        ).toHaveLength(1);
        const lost = outcomes.find(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === 'rejected',
        );
        expect(lost?.reason).toBeInstanceOf(TimelineVersionStaleError);
        expect(w.db.timelines[0]!.version).toBe(2);
        expect(w.db.auditEvents).toHaveLength(1);
        // One change applied, never both: the loser is not merged in.
        const nameApplied = w.db.timelines[0]!.name === 'Ana name';
        const stepApplied =
          w.db.steps.find(
            (s) => s.timelineId === timelineId && s.position === 1,
          )?.closesAt === '2026-11-07T23:59';
        expect(Number(nameApplied) + Number(stepApplied)).toBe(1);
      },
    );
  });

  describe('the idempotency key (FR-13, design 7.6)', () => {
    it('an applied edit marks the key executed in its transaction, with the timeline id as the target', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const { store, ctx } = await keyed(w);

      await edit(w, timelineId, { name: 'Renamed' }, ctx);

      expect(store.peek(7, 'key-1')).toMatchObject({
        state: 'executed',
        targetUserId: timelineId,
      });
    });

    it('a request that lost its key to a take-over rolls the whole edit back', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const { store, ctx } = await keyed(w);
      store.seed({ ...store.peek(7, 'key-1')!, ownerToken: 'someone-else' });

      // The statements ran (the write log keeps rolled-back ones); the rows did not stay.
      const rows = () =>
        JSON.stringify([
          w.db.timelines,
          w.db.steps,
          w.db.programs,
          w.db.resultTypes,
          w.db.auditEvents,
        ]);
      const before = rows();
      const error = await refusal(
        edit(
          w,
          timelineId,
          { name: 'Renamed', steps: [{ position: 1, closesOn: '2026-11-07' }] },
          ctx,
        ),
      );

      expect(error).toBeInstanceOf(IdempotencyFenceLostError);
      expect(rows()).toBe(before);
      expect(w.db.auditEvents).toEqual([]);
      expect(w.unitOfWork.rolledBack).toBe(1);
      expect(w.db.timelines[0]).toMatchObject({
        name: 'July 2026',
        version: 1,
      });
    });

    it('a no-op and a refused edit leave the key unmarked', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      const { store, ctx } = await keyed(w);

      await edit(w, timelineId, { name: 'July 2026' }, ctx);
      expect(store.peek(7, 'key-1')).toMatchObject({ state: 'in_progress' });

      await refusal(edit(w, timelineId, { version: 5, name: 'Renamed' }, ctx));
      expect(store.peek(7, 'key-1')).toMatchObject({ state: 'in_progress' });
    });
  });

  describe('the clock and the statements (NFR-4, NFR-5)', () => {
    it('reads the clock once per edit, whether it writes, is a no-op or is refused; updated_at and the audit time are the same instant', async () => {
      const w = world();
      const { timelineId } = await seeded(w);

      w.clockReads.mockClear();
      await edit(w, timelineId, { name: 'Renamed' });
      expect(w.clockReads).toHaveBeenCalledTimes(1);

      w.clockReads.mockClear();
      await edit(w, timelineId, { version: 2, name: 'Renamed' });
      expect(w.clockReads).toHaveBeenCalledTimes(1);

      w.clockReads.mockClear();
      await refusal(edit(w, timelineId, { version: 2, name: '' }));
      expect(w.clockReads).toHaveBeenCalledTimes(1);

      expect(w.db.timelines[0]!.updatedAt).toEqual(NOW);
      expect(w.db.auditEvents[0]!.createdAt).toEqual(
        w.db.timelines[0]!.updatedAt,
      );
    });

    const FIVE_DATES = [
      ['2026-11-02', '2026-11-06'],
      ['2026-11-09', '2026-11-13'],
      ['2026-11-16', '2026-11-20'],
      ['2026-11-23', '2026-11-27'],
      ['2026-11-30', '2026-12-04'],
    ] as const;
    const NEW_CLOSE = [
      '2026-11-07',
      '2026-11-14',
      '2026-11-21',
      '2026-11-28',
      '2026-12-05',
    ] as const;

    it('an edit runs the same statements on a timeline of two steps and on one of five; each changed step adds one UPDATE and nothing else grows', async () => {
      const statements = async (steps: 2 | 5, changed: number[]) => {
        const w = world();
        const { timelineId } = await seeded(w, {
          steps: w.service
            .defaultSteps()
            .slice(0, steps)
            .map((step, index) => ({
              ...step,
              opensOn: FIVE_DATES[index]![0],
              closesOn: FIVE_DATES[index]![1],
            })),
        });
        const { store, ctx } = await keyed(w);
        w.db.timelineReadLog.length = 0;
        const writes = w.db.timelineWriteLog.length;

        await edit(
          w,
          timelineId,
          {
            steps: changed.map((position) => ({
              position,
              closesOn: NEW_CLOSE[position - 1]!,
            })),
          },
          ctx,
        );

        expect(store.peek(7, 'key-1')).toMatchObject({ state: 'executed' });
        return {
          reads: [...w.db.timelineReadLog],
          writes: w.db.timelineWriteLog.slice(writes),
        };
      };

      const two = await statements(2, [1]);
      const five = await statements(5, [1]);
      const allFive = await statements(5, [1, 2, 3, 4, 5]);

      // 4 reads of the bundle, the cycle (unlocked), the load; in the
      // transaction the cycle (shared) and the timeline (for update); after the
      // commit the six reads of `get`. The key mark is the transaction's last
      // statement, on the idempotency table (asserted `executed` above).
      expect(two.reads).toEqual([
        'timeline:1',
        'steps:1',
        'programs:1',
        'result-types:1',
        'cycle-status:1',
        'loads:1',
        'cycle-status:1',
        'timeline:1:for-update',
        'timeline:1',
        'steps:1',
        'programs:1',
        'result-types:1',
        'assigned:1',
        'loads:1',
      ]);
      expect(two.writes).toEqual([
        'timeline:update:1',
        'step:update:1:1',
        'audit:1',
      ]);
      expect(five).toEqual(two);
      expect(allFive.reads).toEqual(two.reads);
      expect(allFive.writes).toEqual([
        'timeline:update:1',
        'step:update:1:1',
        'step:update:1:2',
        'step:update:1:3',
        'step:update:1:4',
        'step:update:1:5',
        'audit:1',
      ]);
    });
  });

  describe('the decision line (NFR-7, design 7.5)', () => {
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
      action: 'timeline_update',
      actorId: 7,
      requestId: 'req-1',
      idempotency: 'none',
    };

    it('an applied edit writes one line with ids and fixed words, and never a name, a date or a scope', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      lines.length = 0;

      await edit(w, timelineId, {
        name: 'Secret rename',
        steps: [{ position: 1, closesOn: '2026-11-07' }],
      });

      expect(lines).toEqual([
        { level: 'log', line: { ...base, targetId: 1, outcome: 'ok' } },
      ]);
      expect(JSON.stringify(lines)).not.toContain('Secret');
      expect(JSON.stringify(lines)).not.toContain('2026-11-07');
    });

    it('a no-op writes one ok line with the timeline id', async () => {
      const w = world();
      const { timelineId } = await seeded(w);
      lines.length = 0;

      await edit(w, timelineId, { name: 'July 2026' });

      expect(lines).toEqual([
        { level: 'log', line: { ...base, targetId: 1, outcome: 'ok' } },
      ]);
    });

    it.each([
      [
        'an unknown timeline',
        'warn',
        'refused',
        'TIMELINES_NOT_FOUND',
        (w: EditWorld) => edit(w, 99, { name: 'Secret rename' }),
      ],
      [
        'a stale version',
        'warn',
        'refused',
        'TIMELINES_VERSION_STALE',
        (w: EditWorld) => edit(w, 1, { version: 9, name: 'Secret rename' }),
      ],
      [
        'a request that breaks rules',
        'warn',
        'refused',
        'VALIDATION_FAILED',
        (w: EditWorld) => edit(w, 1, { name: '' }),
      ],
      [
        'an unconfirmed in-progress change',
        'warn',
        'refused',
        'TIMELINES_IN_PROGRESS_UNCONFIRMED',
        (w: EditWorld) => {
          startStepTwo(w, 1);
          return edit(w, 1, {
            steps: [{ position: 2, closesOn: '2026-11-15' }],
          });
        },
      ],
      [
        'a catalog that cannot be read',
        'error',
        'error',
        'SERVICE_UNAVAILABLE',
        (w: EditWorld) => {
          w.programSource.list.mockRejectedValue(
            new UpstreamUnavailableError(),
          );
          return edit(w, 1, { allPrograms: false, programIds: [1] });
        },
      ],
    ])(
      '%s writes one line (warn for a refusal, error for a 5xx) with the catalog code as the reason, no target and no body field',
      async (_label, level, outcome, code, run) => {
        const w = world();
        await seeded(w);
        lines.length = 0;
        const before = w.written();

        await refusal(run(w));

        // A refusal that logs a line wrote nothing: no row, no statement, no audit row.
        expect(w.written()).toBe(before);
        expect(w.db.auditEvents).toEqual([]);
        expect(lines).toEqual([
          {
            level,
            line: { ...base, targetId: null, outcome, reason: code },
          },
        ]);
        expect(JSON.stringify(lines)).not.toContain('Secret');
        expect(JSON.stringify(lines)).not.toContain('2026-11-15');
      },
    );
  });
});
