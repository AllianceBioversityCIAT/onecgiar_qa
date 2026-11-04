// @akili-spec ingestion/step-1-loads
import { drizzle } from 'drizzle-orm/mysql2';
import {
  InMemoryAdminConfigDatabase,
  InMemoryTimelinesUnitOfWork,
} from '../../test/support/in-memory-admin-config.js';
import {
  FakeClock,
  roundTrip,
} from '../../test/support/in-memory-idempotency.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from '../../test/support/in-memory-loads.js';
import { type RomeMinute } from '../admin-config/rome-date.js';
import { IdempotencyFenceLostError } from '../common/idempotency/idempotency.errors.js';
import type { Cycle } from '../database/drizzle/schema/cycles.js';
import * as schema from '../database/drizzle/schema/index.js';
import type { TimelineLoad } from '../database/drizzle/schema/timeline-loads.js';
import type { TimelineResult } from '../database/drizzle/schema/timeline-results.js';
import type { TimelineAuditEvent } from '../database/drizzle/schema/timeline-audit-events.js';
import type { TimelinesRepositories } from '../admin-config/timelines/timelines.unit-of-work.js';
import {
  DrizzleLoadsStore,
  type LoadsStore,
  type NewMembershipValues,
} from './loads.store.js';
import {
  DrizzleLoadsTransactions,
  LoadsUnitOfWork,
  type LoadsTransactions,
  type LotMembership,
  type RecordLotCommand,
  type StartLoadCommand,
} from './loads.unit-of-work.js';

// Expected values are design 7.2 / 7.3 and the FR-2, FR-4, FR-9, FR-11 and
// FR-12 scenarios written out, with the literals of the schema (key names,
// column names, audit shapes), none read from the code under test. Two worlds
// run the same unit of work: the real Drizzle adapters over a stub MySQL driver
// (the statements, in order, on the transaction connection) and the in-memory
// world (the unique keys, the row locks, two transactions interleaved at every
// statement). There is no disposable MySQL (the shared qadb is never touched).

// 2026-11-10 09:00 in Rome (UTC+1 after the clock change of 25 Oct).
const NOW = new Date('2026-11-10T08:00:00.000Z');
const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const minute = (value: string) => value as RomeMinute;

const SCOPE = {
  allPrograms: false,
  programIds: [2],
  allResultTypes: false,
  resultTypeKeys: ['KP'],
};

const startCommand = (
  overrides: Partial<StartLoadCommand> = {},
): StartLoadCommand => ({
  cycleId: 1,
  timelineId: 11,
  actorId: 9,
  requestId: 'req-1',
  now: NOW,
  ...overrides,
});

const lotMember = (
  resultCode: number,
  overrides: Partial<LotMembership> = {},
): LotMembership => ({
  resultCode,
  resultId: resultCode + 1000,
  programClarisaId: 2,
  resultTypeKey: 'KP',
  status: 'pending',
  kpGroup: null,
  awaitsStep: null,
  snapshotSk: `SNAP#2026#000001#00000011#${resultCode}`,
  snapshotHash: 'a'.repeat(64),
  catalogVersion: '1.29',
  ...overrides,
});

const lotCommand = (
  loadId: number,
  codes: number[],
  overrides: Partial<RecordLotCommand> = {},
): RecordLotCommand => ({
  loadId,
  memberships: codes.map((code) => lotMember(code)),
  processed: codes.length,
  skips: { skipped: {}, otherTimelines: {} },
  now: NOW,
  ...overrides,
});

// --- the in-memory world ----------------------------------------------------

function cycleRow(id: number, status: Cycle['status'] = 'active'): Cycle {
  const created = new Date('2026-10-01T09:00:00.000Z');
  return {
    id,
    year: 2025 + id,
    status,
    activeKey: status === 'active' ? 1 : null,
    createdAt: created,
    createdBy: 1,
    activatedAt: status === 'draft' ? null : created,
    activatedBy: status === 'draft' ? null : 1,
    closedAt: status === 'closed' ? created : null,
    closedBy: status === 'closed' ? 1 : null,
  };
}

interface TimelineSeed {
  id: number;
  cycleId?: number;
  name: string;
  version?: number;
  /** Closing minute of step 1; the window of FR-2 ends here. */
  step1Closes?: string;
  /** Closing minute of the last step (DD-5). */
  lastCloses?: string;
  allPrograms?: boolean;
  programs?: number[];
  resultTypes?: string[];
}

/** A timeline of three steps (ids `id * 10 + position`), program 2 and result type KP by default. */
function addTimeline(
  admin: InMemoryAdminConfigDatabase,
  seed: TimelineSeed,
): void {
  const cycleId = seed.cycleId ?? 1;
  const created = new Date('2026-10-01T09:00:00.000Z');
  admin.timelines.push({
    id: seed.id,
    cycleId,
    name: seed.name,
    kind: 'additional',
    officialKey: null,
    allPrograms: seed.allPrograms ?? false,
    allResultTypes: false,
    createdAt: created,
    createdBy: 1,
    version: seed.version ?? 1,
    updatedAt: null,
    updatedBy: null,
  });
  const audiences = ['assessors', 'programs', 'lead_assessors'] as const;
  const moments = [
    ['2026-11-02T09:00', seed.step1Closes ?? '2026-11-20T17:30'],
    ['2026-11-23T09:00', '2026-12-04T17:30'],
    ['2026-12-07T09:00', seed.lastCloses ?? '2026-12-18T17:30'],
  ] as const;
  moments.forEach(([opensAt, closesAt], index) => {
    admin.steps.push({
      id: seed.id * 10 + index + 1,
      timelineId: seed.id,
      position: index + 1,
      name: `Step ${index + 1}`,
      audience: audiences[index]!,
      opensAt: minute(opensAt),
      closesAt: minute(closesAt),
      round: 1,
      requiresLoad: index === 0,
    });
  });
  for (const programId of seed.programs ?? [2]) {
    admin.programs.push({ timelineId: seed.id, programId });
  }
  for (const resultTypeKey of seed.resultTypes ?? ['KP']) {
    admin.resultTypes.push({ timelineId: seed.id, resultTypeKey });
  }
}

/** Cycle 1 (active) with timelines 11 (version 4), 12 and 13; cycle 2 (draft) with timeline 21. */
function seedWorld() {
  const world = new InMemoryLoadsDatabase();
  world.admin.cycles.push(cycleRow(1), cycleRow(2, 'draft'));
  addTimeline(world.admin, { id: 11, name: 'July 2026', version: 4 });
  addTimeline(world.admin, { id: 12, name: 'August 2026' });
  addTimeline(world.admin, { id: 13, name: 'September 2026' });
  addTimeline(world.admin, { id: 21, cycleId: 2, name: 'Next year' });
  return world;
}

function loadRow(
  overrides: Partial<TimelineLoad> & Pick<TimelineLoad, 'id' | 'timelineId'>,
): TimelineLoad {
  const row: TimelineLoad = {
    cycleId: 1,
    timelineStepId: overrides.timelineId * 10 + 1,
    phaseYear: 2026,
    scope: structuredClone(SCOPE),
    status: 'running',
    runningKey: null,
    total: null,
    processed: 0,
    summary: null,
    failureReason: null,
    startedBy: 9,
    startedAt: ago(30 * MINUTE),
    heartbeatAt: NOW,
    finishedAt: null,
    requestId: 'req-0',
    ...overrides,
  };
  // The generated column: the cycle id while running, NULL otherwise.
  row.runningKey = row.status === 'running' ? row.cycleId : null;
  return row;
}

function memberRow(
  overrides: Partial<TimelineResult> &
    Pick<TimelineResult, 'id' | 'timelineId' | 'resultCode'>,
): TimelineResult {
  const row: TimelineResult = {
    cycleId: 1,
    loadId: 40,
    resultId: overrides.resultCode + 1000,
    phaseYear: 2026,
    programClarisaId: 2,
    resultTypeKey: 'KP',
    status: 'pending',
    kpGroup: null,
    awaitsStep: null,
    snapshotSk: 'SNAP#',
    snapshotHash: 'b'.repeat(64),
    catalogVersion: '1.29',
    createdAt: ago(60 * MINUTE),
    endedAt: null,
    endReason: null,
    activeKey: null,
    ...overrides,
  };
  // The generated column: `cycle#code` while active, NULL once ended.
  row.activeKey =
    row.endedAt === null ? `${row.cycleId}#${row.resultCode}` : null;
  return row;
}

function inMemory(world = seedWorld()) {
  const transactions = new InMemoryLoadsTransactions(world);
  return { world, transactions, uow: new LoadsUnitOfWork(transactions) };
}

const auditOf = (world: InMemoryLoadsDatabase, action: string) =>
  world.admin.auditEvents.filter((event) => event.action === action);

const version = (world: InMemoryLoadsDatabase, timelineId: number) =>
  world.admin.timelines.find((t) => t.id === timelineId)!.version;

// --- the guard: the fake itself refuses what the unique keys refuse ---------

describe('the in-memory loads world refuses what the unique keys refuse (the guard of every concurrency case below)', () => {
  const newLoad = (cycleId: number, timelineId: number) => ({
    cycleId,
    timelineId,
    timelineStepId: timelineId * 10 + 1,
    phaseYear: 2026,
    scope: structuredClone(SCOPE),
    summary: {
      loaded: 0,
      byProgram: {},
      byType: {},
      kpGroups: {},
      skipped: {},
      otherTimelines: {},
    },
    startedBy: 9,
    startedAt: NOW,
    requestId: null,
  });
  const newMember = (
    cycleId: number,
    timelineId: number,
    resultCode: number,
  ) => ({
    cycleId,
    timelineId,
    loadId: 40,
    resultCode,
    resultId: resultCode + 1000,
    phaseYear: 2026,
    programClarisaId: 2,
    resultTypeKey: 'KP',
    status: 'pending' as const,
    kpGroup: null,
    awaitsStep: null,
    snapshotSk: 'SNAP#',
    snapshotHash: 'c'.repeat(64),
    catalogVersion: '1.29',
    createdAt: NOW,
  });

  it('running_key: a second running load in one cycle is refused, a load of another cycle is not, and a finished load frees the cycle', async () => {
    const { store, loads, violations } = new InMemoryLoadsDatabase();

    const first = await store.insertLoad(newLoad(1, 11));
    const second = await store.insertLoad(newLoad(1, 12));
    const otherCycle = await store.insertLoad(newLoad(2, 21));

    expect(first).toEqual({ kind: 'created', loadId: 1 });
    expect(second).toEqual({ kind: 'already_running' });
    expect(otherCycle).toEqual({ kind: 'created', loadId: 2 });
    expect(loads.map((l) => [l.id, l.runningKey])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(violations).toEqual({
      runningKey: 1,
      activeKey: 0,
      timelineCode: 0,
    });

    // Ending the load sets the generated key to NULL: the cycle is free again,
    // and a finished load never blocks (a unique key allows many NULLs).
    expect(
      await store.endLoad(1, {
        status: 'completed',
        failureReason: null,
        finishedAt: NOW,
      }),
    ).toBe(true);
    expect(loads[0]).toMatchObject({ status: 'completed', runningKey: null });
    expect(await store.insertLoad(newLoad(1, 12))).toEqual({
      kind: 'created',
      loadId: 3,
    });
    // An ended load cannot be ended again (the conditional UPDATE matches nothing).
    expect(
      await store.endLoad(1, {
        status: 'failed',
        failureReason: 'INTERNAL',
        finishedAt: NOW,
      }),
    ).toBe(false);
    expect(loads[0]!.status).toBe('completed');
  });

  it('active_key: a second active membership of one result in one cycle is refused, another cycle is not, an ended one frees the key', async () => {
    const { store, results, violations } = new InMemoryLoadsDatabase();

    expect(await store.insertMembership(newMember(1, 11, 5120))).toEqual({
      kind: 'created',
    });
    expect(await store.insertMembership(newMember(1, 12, 5120))).toEqual({
      kind: 'duplicate',
      key: 'active_key',
    });
    expect(await store.insertMembership(newMember(2, 21, 5120))).toEqual({
      kind: 'created',
    });
    expect(results.map((r) => [r.cycleId, r.timelineId, r.activeKey])).toEqual([
      [1, 11, '1#5120'],
      [2, 21, '2#5120'],
    ]);
    expect(violations).toEqual({
      runningKey: 0,
      activeKey: 1,
      timelineCode: 0,
    });

    // Ending the membership sets the generated key to NULL: another timeline
    // of the cycle can now take the result (FR-4, "later timeline after U closed").
    expect(await store.endMemberships([1], NOW, 'timeline_closed')).toBe(1);
    expect(results[0]).toMatchObject({
      endedAt: NOW,
      endReason: 'timeline_closed',
      activeKey: null,
    });
    expect(await store.insertMembership(newMember(1, 12, 5120))).toEqual({
      kind: 'created',
    });
    // Ending twice changes nothing.
    expect(await store.endMemberships([1], NOW, 'timeline_closed')).toBe(0);
  });

  it('(timeline_id, result_code): refused even after the membership ended, and named first when both keys would refuse', async () => {
    const { store, results, violations } = new InMemoryLoadsDatabase();
    await store.insertMembership(newMember(1, 11, 5120));

    // Active in this timeline: both keys refuse; InnoDB reports the one
    // migration 0007 created first, the timeline's own.
    expect(await store.insertMembership(newMember(1, 11, 5120))).toEqual({
      kind: 'duplicate',
      key: 'timeline_code',
    });

    // Ended: only the timeline's own key refuses (S-5, DD-3).
    await store.endMemberships([1], NOW, 'released_qaed');
    expect(await store.insertMembership(newMember(1, 11, 5120))).toEqual({
      kind: 'duplicate',
      key: 'timeline_code',
    });
    expect(results).toHaveLength(1);
    expect(violations).toEqual({
      runningKey: 0,
      activeKey: 0,
      timelineCode: 2,
    });
  });

  it('inside a transaction the same keys refuse: an identical INSERT waits for the first one, then finds its row', async () => {
    const world = new InMemoryLoadsDatabase();
    const transactions = new InMemoryLoadsTransactions(world);

    const outcomes = await Promise.all([
      transactions.run(({ loads }) => loads.insertLoad(newLoad(1, 11))),
      transactions.run(({ loads }) => loads.insertLoad(newLoad(1, 12))),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toEqual([
      'already_running',
      'created',
    ]);
    expect(world.loads).toHaveLength(1);
    expect(world.violations.runningKey).toBe(1);
  });

  // The foreign keys: InnoDB checks one by taking S on the parent row, so a
  // child INSERT waits for a transaction that holds that parent FOR UPDATE.
  // This is what lets the cases of the lock order below show a lock cycle at
  // all: without these locks the fake could not tell the two orders apart.
  const newAudit = {
    timelineId: 11,
    actorId: 9,
    action: 'load_end' as const,
    changes: {},
    requestId: null,
    createdAt: NOW,
  };
  it.each([
    {
      what: 'a membership',
      parent: 'cycles:1',
      insert: (loads: LoadsStore) =>
        loads.insertMembership(newMember(1, 11, 5120)),
    },
    {
      what: 'a membership',
      parent: 'timelines:11',
      insert: (loads: LoadsStore) =>
        loads.insertMembership(newMember(1, 11, 5120)),
    },
    {
      what: 'a membership',
      parent: 'timeline_loads:40',
      insert: (loads: LoadsStore) =>
        loads.insertMembership(newMember(1, 11, 5120)),
    },
    {
      what: 'an audit row',
      parent: 'timelines:11',
      insert: (loads: LoadsStore) => loads.insertAuditEvent(newAudit),
    },
    {
      what: 'a load',
      parent: 'cycles:1',
      insert: (loads: LoadsStore) => loads.insertLoad(newLoad(1, 11)),
    },
    {
      what: 'a load',
      parent: 'timelines:11',
      insert: (loads: LoadsStore) => loads.insertLoad(newLoad(1, 11)),
    },
  ])(
    'the INSERT of $what takes S on its foreign-key parent $parent: it waits for a transaction that holds that row FOR UPDATE',
    async ({ parent, insert }) => {
      const world = new InMemoryLoadsDatabase();
      const transactions = new InMemoryLoadsTransactions(world);
      const holder = world.admin.base.begin('read committed');
      await holder.lock(parent, 'X');
      let inserted = false;

      const child = transactions.run(async ({ loads }) => {
        await insert(loads);
        inserted = true;
      });
      for (let turn = 0; turn < 10; turn++) await roundTrip();
      expect(inserted).toBe(false);
      holder.rollback();
      await child;

      expect(inserted).toBe(true);
    },
  );
});

// --- the real adapters over a stub MySQL driver -----------------------------

interface Statement {
  via: 'pool' | 'tx';
  sql: string;
  params: unknown[];
}

const stamp = '2026-11-10 07:00:00';

const duplicate = (key: string) =>
  Object.assign(new Error(`Duplicate entry '1' for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: `Duplicate entry '1' for key '${key}'`,
  });

/** A `timeline_loads` row in table order, as the driver hands it over. */
function loadValues(o: {
  id: number;
  timelineId: number;
  status?: string;
  heartbeatAt: string;
  processed?: number;
  summary?: Record<string, unknown> | null;
}) {
  const status = o.status ?? 'running';
  return [
    o.id,
    1,
    o.timelineId,
    o.timelineId * 10 + 1,
    2026,
    SCOPE,
    status,
    status === 'running' ? 1 : null,
    120,
    o.processed ?? 0,
    o.summary ?? null,
    null,
    9,
    stamp,
    o.heartbeatAt,
    null,
    'req-0',
  ];
}

interface StubOptions {
  /** The status the cycle row is read with (default `active`). */
  cycleStatus?: 'draft' | 'active' | 'closed';
  /** The `timelines` rows (default: timeline 11 of cycle 1 at version 4). */
  timelines?: unknown[][];
  /** Step 1's closing minute as the driver hands it over (default 2026-11-20 17:30). */
  step1Closes?: string;
  /** The row the `running_key` select finds (default none). */
  running?: unknown[][];
  /** The row `SELECT ... WHERE id = ? FOR UPDATE` finds (default a running load 41 with a fresh heartbeat). */
  locked?: unknown[][];
  /** The insert into `timeline_loads` is refused with this error. */
  loadInsertError?: Error;
  /** Rows the UPDATE of `timeline_loads` matches (default 1). */
  endRows?: number;
  /** Rows the key mark matches (default 1; 0 is a lost take-over fence). */
  fenceRows?: number;
  /** Throws on the n-th insert into `timeline_results` (1-based) when it returns an error. */
  membershipError?: (attempt: number) => Error | undefined;
  /** What the select of `timeline_results` finds, columns id, result_code, timeline_id, ended_at. */
  memberships?: unknown[][];
  /** What the select of the last steps finds, columns timeline_id, name, closes_at. */
  lastSteps?: unknown[][];
  /** What the loads list finds (a `timeline_loads` row, then the nickname). */
  loadList?: unknown[][];
}

function stub(options: StubOptions = {}) {
  const log: Statement[] = [];
  let membershipInserts = 0;
  const answer = (via: Statement['via']) => ({
    query: ({ sql }: { sql: string }, values?: unknown[]) => {
      log.push({ via, sql, params: values ?? [] });
      if (sql.startsWith('insert into `timeline_loads`')) {
        if (options.loadInsertError) {
          return Promise.reject(options.loadInsertError);
        }
        return Promise.resolve([{ insertId: 41, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('insert into `timeline_results`')) {
        const error = options.membershipError?.(++membershipInserts);
        if (error) return Promise.reject(error);
        return Promise.resolve([{ insertId: 7, affectedRows: 1 }, []]);
      }
      if (sql.startsWith('insert')) {
        return Promise.resolve([{ insertId: 0, affectedRows: 1 }, []]);
      }
      if (!sql.startsWith('select')) {
        const affectedRows = sql.startsWith('update `idempotency_keys`')
          ? (options.fenceRows ?? 1)
          : sql.startsWith('update `timeline_loads` set `status`')
            ? (options.endRows ?? 1)
            : sql.startsWith('update `timeline_results`')
              ? // `ended_at` and `end_reason`, then one id each.
                (values?.length ?? 2) - 2
              : 1;
        return Promise.resolve([{ affectedRows }, []]);
      }
      let rows: unknown[][];
      if (sql.includes('from `cycles`')) {
        rows = [[options.cycleStatus ?? 'active', 2026]];
      } else if (sql.includes('from `timeline_steps` inner join')) {
        rows = options.lastSteps ?? [];
      } else if (sql.includes('from `timeline_steps`')) {
        rows = [[111, options.step1Closes ?? '2026-11-20 17:30:00']];
      } else if (sql.includes('from `timeline_programs`')) rows = [[2]];
      else if (sql.includes('from `timeline_result_types`')) rows = [['KP']];
      else if (sql.includes('from `timeline_results`')) {
        // As the IN of the statement would: only the rows whose code it asks for.
        rows = (options.memberships ?? []).filter((row) =>
          (values ?? []).slice(1).includes(row[1]),
        );
      } else if (sql.includes('from `timeline_loads` inner join')) {
        rows = options.loadList ?? [];
      } else if (sql.includes('`running_key` = ?'))
        rows = options.running ?? [];
      else if (sql.includes('from `timeline_loads`')) {
        rows = options.locked ?? [
          loadValues({ id: 41, timelineId: 11, heartbeatAt: stamp }),
        ];
      } else {
        // A `timelines` row in table order: id, cycle_id, name, kind,
        // official_key, all_programs, all_result_types, created_at, created_by,
        // version, updated_at, updated_by.
        rows = options.timelines ?? [
          [11, 1, 'July 2026', 'official', 1, 0, 0, stamp, 1, 4, null, null],
        ];
      }
      return Promise.resolve([rows, []]);
    },
  });
  // A pool, as in production: a transaction takes one connection from it.
  const pool = {
    ...answer('pool'),
    getConnection: async () => ({ ...answer('tx'), release: () => {} }),
  };
  const db = drizzle({ client: pool as never, schema, mode: 'default' });
  return {
    log,
    db,
    store: new DrizzleLoadsStore(db),
    uow: new LoadsUnitOfWork(new DrizzleLoadsTransactions(db)),
  };
}

/** From `begin` to the last `commit` or `rollback`. */
const inTransaction = (log: Statement[]) =>
  log.slice(
    log.findIndex((s) => s.sql === 'begin'),
    log.findLastIndex((s) => s.sql === 'commit' || s.sql === 'rollback') + 1,
  );

const writes = (statements: Statement[]) =>
  statements.filter((s) => /^(insert|update|delete)/.test(s.sql));

const reservation = { actorId: 9, key: 'k-1', ownerToken: 'token-1' };

/**
 * The statements a lot and an end open with, in the order of the start (DD-9,
 * P-8): the load read plain for its cycle and timeline, the cycle row FOR SHARE,
 * the timeline row FOR SHARE, then the load row FOR UPDATE. A foreign-key insert
 * takes S on those parents, so none may be asked for after the load row.
 */
function expectLoadLockOrder(
  inTx: Statement[],
  ids: { loadId: number; cycleId: number; timelineId: number },
): void {
  const expected: Array<[RegExp, number]> = [
    [
      /^select .* from `timeline_loads` where `timeline_loads`\.`id` = \? limit \?$/,
      ids.loadId,
    ],
    [
      /^select `status`, `year` from `cycles` where `cycles`\.`id` = \? limit \? for share$/,
      ids.cycleId,
    ],
    [
      /^select `id` from `timelines` where `timelines`\.`id` = \? limit \? for share$/,
      ids.timelineId,
    ],
    [
      /^select .* from `timeline_loads` where `timeline_loads`\.`id` = \? limit \? for update$/,
      ids.loadId,
    ],
  ];
  expect(inTx[0]!.sql).toBe('begin');
  expected.forEach(([pattern, param], at) => {
    expect(inTx[at + 1]!.sql).toMatch(pattern);
    expect(inTx[at + 1]!.params[0]).toBe(param);
  });
}

describe('LoadsUnitOfWork.start over a stub MySQL driver (design 7.2, DD-7, P-8)', () => {
  // The SQL order of the start. The two locks first, in the order of the
  // timeline edit (`timelines.unit-of-work.spec.ts`): the cycle FOR SHARE, then
  // the timeline FOR UPDATE; then the step, the running load FOR UPDATE, the
  // scope, the insert, the version bump, the audit row and the key mark.
  const startOrder = [
    /^begin$/,
    /^select `status`, `year` from `cycles` where `cycles`\.`id` = \? limit \? for share$/,
    /^select .* from `timelines` where `timelines`\.`id` = \? limit \? for update$/,
    /^select `id`, `closes_at` from `timeline_steps` where \(`timeline_steps`\.`timeline_id` = \? and `timeline_steps`\.`position` = \?\) limit \?$/,
    // Read plain first, so the timeline of a stale load can be locked before it.
    /^select .* from `timeline_loads` where `timeline_loads`\.`running_key` = \? limit \?$/,
    /^select .* from `timeline_loads` where `timeline_loads`\.`running_key` = \? limit \? for update$/,
    /^select `program_id` from `timeline_programs` where `timeline_programs`\.`timeline_id` = \? order by /,
    /^select `result_type_key` from `timeline_result_types` where `timeline_result_types`\.`timeline_id` = \? order by /,
    /^insert into `timeline_loads` /,
    /^update `timelines` set `version` = `timelines`\.`version` \+ 1 where `timelines`\.`id` = \?$/,
    /^insert into `timeline_audit_events` /,
    /^update `idempotency_keys` /,
    /^commit$/,
  ];

  it('a keyed start: READ COMMITTED, the cycle FOR SHARE first, then the timeline FOR UPDATE, the step, the running load, the scope, the load, the version, the audit row and the key mark, all on the transaction connection', async () => {
    const { uow, log } = stub();

    const result = await uow.start(startCommand({ cycleId: 1, reservation }));

    expect(result).toEqual({
      kind: 'started',
      loadId: 41,
      abandonedLoadIds: [],
    });
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = inTransaction(log);
    // Nothing of the start, the audit row included, ran outside the transaction.
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(log.filter((s) => s.via === 'pool')).toEqual([]);
    expect(inTx.map((s) => s.sql)).toHaveLength(startOrder.length);
    startOrder.forEach((expected, at) => {
      expect(inTx[at]!.sql).toMatch(expected);
    });
    expect(inTx[1]!.params[0]).toBe(1);
    expect(inTx[2]!.params[0]).toBe(11);
    expect(inTx[3]!.params[0]).toBe(11);
    expect(inTx[3]!.params[1]).toBe(1);
    expect(inTx[4]!.params[0]).toBe(1);
    expect(inTx[5]!.params[0]).toBe(1);
  });

  it('the load insert writes the scope read under the lock, the start as the first heartbeat, and never the generated key', async () => {
    const { uow, log } = stub();

    await uow.start(startCommand({ cycleId: 1, requestId: 'req-9' }));

    const insert = inTransaction(log).find((s) =>
      s.sql.startsWith('insert into `timeline_loads`'),
    )!;
    expect(insert.sql).not.toContain('running_key');
    expect(insert.params).toEqual(
      expect.arrayContaining([
        1,
        11,
        111,
        2026,
        JSON.stringify(SCOPE),
        'running',
        0,
        9,
        'req-9',
      ]),
    );
    // `started_at` and `heartbeat_at` are the one instant the service read.
    expect(
      insert.params.filter((p) => p === '2026-11-10 08:00:00.000'),
    ).toHaveLength(2);
  });

  it('the version bump writes the version and nothing else of the timeline', async () => {
    const { uow, log } = stub();

    await uow.start(startCommand({ cycleId: 1 }));

    const update = inTransaction(log).find((s) =>
      s.sql.startsWith('update `timelines`'),
    )!;
    expect(update.sql).toBe(
      'update `timelines` set `version` = `timelines`.`version` + 1 where `timelines`.`id` = ?',
    );
    expect(update.params).toEqual([11]);
  });

  it('the load_start row: the actor, the timeline, the load id, the phase year and the scope, and no PII', async () => {
    const { uow, log } = stub();

    await uow.start(startCommand({ cycleId: 1, requestId: 'req-9' }));

    const audit = inTransaction(log).find((s) =>
      s.sql.startsWith('insert into `timeline_audit_events`'),
    )!;
    expect(audit.params).toEqual([
      11,
      9,
      'load_start',
      '{"load":{"before":null,"after":{"id":41,"phaseYear":2026,"scope":{"allPrograms":false,"programIds":[2],"allResultTypes":false,"resultTypeKeys":["KP"]}}}}',
      'req-9',
      '2026-11-10 08:00:00.000',
    ]);
  });

  it('an unkeyed start marks nothing', async () => {
    const { uow, log } = stub();

    await uow.start(startCommand({ cycleId: 1 }));

    expect(log.some((s) => s.sql.startsWith('update `idempotency_keys`'))).toBe(
      false,
    );
  });

  it('a stale running load is ended inside the start, its load_end row written, before the new load is inserted', async () => {
    // Heartbeat 5 min 1 s old: past the lease of FR-9 (the stub's clock is NOW).
    const { uow, log } = stub({
      running: [
        loadValues({
          id: 40,
          timelineId: 12,
          heartbeatAt: '2026-11-10 07:54:59',
          processed: 100,
          summary: { loaded: 80, skipped: { ALREADY_IN_THIS_TIMELINE: 20 } },
        }),
      ],
    });

    const result = await uow.start(startCommand({ cycleId: 1 }));

    expect(result).toEqual({
      kind: 'started',
      loadId: 41,
      abandonedLoadIds: [40],
    });
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'select `status`, `year`',
      'select `id`, `cycle_id`,',
      'select `id`, `closes_at`',
      'select `id`, `cycle_id`,',
      'select `id` from',
      'select `id`, `cycle_id`,',
      'update `timeline_loads` set',
      'insert into `timeline_audit_events`',
      'select `program_id` from',
      'select `result_type_key` from',
      'insert into `timeline_loads`',
      'update `timelines` set',
      'insert into `timeline_audit_events`',
      'commit',
    ]);
    // The stale load is another timeline's: read plain, that timeline row locked
    // FOR SHARE (the foreign key of the load_end row), then the load row FOR UPDATE.
    expect(inTx[4]!.sql).toMatch(/`running_key` = \? limit \?$/);
    expect(inTx[5]!.sql).toMatch(
      /^select `id` from `timelines` where `timelines`\.`id` = \? limit \? for share$/,
    );
    expect(inTx[5]!.params[0]).toBe(12);
    expect(inTx[6]!.sql).toMatch(/`running_key` = \? limit \? for update$/);
    const end = inTx[7]!;
    expect(end.sql).toMatch(
      /^update `timeline_loads` set `status` = \?, `failure_reason` = \?, `finished_at` = \? where \(`timeline_loads`\.`id` = \? and `timeline_loads`\.`status` = \?\)$/,
    );
    expect(end.params).toEqual([
      'failed',
      'ABANDONED',
      '2026-11-10 08:00:00.000',
      40,
      'running',
    ]);
    // The abandoned load's own timeline and starter, the counts it last recorded.
    expect(inTx[8]!.params).toEqual([
      12,
      9,
      'load_end',
      '{"load":{"before":"running","after":{"id":40,"status":"failed","total":120,"processed":100,"loaded":80,"skipped":20,"failureReason":"ABANDONED"}}}',
      'req-1',
      '2026-11-10 08:00:00.000',
    ]);
  });

  it('a running load at exactly the lease is alive: nothing is ended and the insert is refused by the running_key, with a rollback and no write left', async () => {
    const { uow, log } = stub({
      running: [
        loadValues({
          id: 40,
          timelineId: 12,
          heartbeatAt: '2026-11-10 07:55:00',
        }),
      ],
      loadInsertError: duplicate(
        'timeline_loads.uq_timeline_loads_running_key',
      ),
    });

    const result = await uow.start(startCommand({ cycleId: 1, reservation }));

    expect(result).toEqual({ kind: 'already_running' });
    const inTx = inTransaction(log);
    expect(inTx.at(-1)!.sql).toBe('rollback');
    expect(log.some((s) => s.sql === 'commit')).toBe(false);
    // The only write that ran is the refused INSERT; no end, no bump, no audit, no mark.
    expect(
      writes(inTx).map((s) => s.sql.split(' ').slice(0, 3).join(' ')),
    ).toEqual(['insert into `timeline_loads`']);
  });

  it("a stale load of the start's own timeline, or an alive one of another, takes no extra timeline lock", async () => {
    const own = stub({
      running: [
        loadValues({
          id: 40,
          timelineId: 11,
          heartbeatAt: '2026-11-10 07:54:59',
        }),
      ],
    });
    const alive = stub({
      running: [
        loadValues({
          id: 40,
          timelineId: 12,
          heartbeatAt: '2026-11-10 07:55:00',
        }),
      ],
      loadInsertError: duplicate(
        'timeline_loads.uq_timeline_loads_running_key',
      ),
    });

    expect(await own.uow.start(startCommand({ cycleId: 1 }))).toMatchObject({
      kind: 'started',
      abandonedLoadIds: [40],
    });
    expect(await alive.uow.start(startCommand({ cycleId: 1 }))).toEqual({
      kind: 'already_running',
    });

    // The timeline row of the start is locked FOR UPDATE; nothing else asks for S.
    const shares = (log: Statement[]) =>
      log.filter(
        (s) =>
          s.sql.includes('from `timelines`') && s.sql.endsWith('for share'),
      );
    expect(shares(own.log)).toEqual([]);
    expect(shares(alive.log)).toEqual([]);
  });

  it('a 1062 on another key is not read as a running load: it is thrown and rolled back', async () => {
    const { uow, log } = stub({
      loadInsertError: duplicate('timeline_loads.PRIMARY'),
    });

    await expect(uow.start(startCommand({ cycleId: 1 }))).rejects.toMatchObject(
      { cause: { code: 'ER_DUP_ENTRY' } },
    );

    expect(inTransaction(log).at(-1)!.sql).toBe('rollback');
  });

  it('a duplicate key wrapped as the cause of another error is still told apart by its key', async () => {
    const wrapped = Object.assign(new Error('Failed query: insert into'), {
      cause: duplicate('timeline_loads.uq_timeline_loads_running_key'),
    });
    const { uow } = stub({ loadInsertError: wrapped });

    expect(await uow.start(startCommand({ cycleId: 1 }))).toEqual({
      kind: 'already_running',
    });
  });

  it('a closed cycle is refused after the two locks and the step, with no write and a rollback', async () => {
    const { uow, log } = stub({ cycleStatus: 'closed' });

    const result = await uow.start(startCommand({ cycleId: 1 }));

    expect(result).toEqual({ kind: 'cycle_closed' });
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.sql.split(' ')[0])).toEqual([
      'begin',
      'select',
      'select',
      'select',
      'rollback',
    ]);
    expect(writes(inTx)).toEqual([]);
  });

  it('the closing minute is open and the next one is not (FR-2, times S-2): 17:30 Rome starts, 17:31 is LOADS_WINDOW_CLOSED with no write', async () => {
    // 16:30Z and 16:31Z are 17:30 and 17:31 in Rome on 20 Nov.
    const open = stub();
    const closed = stub();

    const atClose = await open.uow.start(
      startCommand({ cycleId: 1, now: new Date('2026-11-20T16:30:00.000Z') }),
    );
    const afterClose = await closed.uow.start(
      startCommand({ cycleId: 1, now: new Date('2026-11-20T16:31:00.000Z') }),
    );

    expect(atClose.kind).toBe('started');
    expect(afterClose).toEqual({ kind: 'window_closed' });
    expect(writes(inTransaction(closed.log))).toEqual([]);
    expect(inTransaction(closed.log).at(-1)!.sql).toBe('rollback');
  });

  it('an unknown timeline, or one of another cycle, is refused with no write', async () => {
    const missing = stub({ timelines: [] });
    const elsewhere = stub({
      timelines: [
        [11, 2, 'July 2026', 'official', 2, 0, 0, stamp, 1, 4, null, null],
      ],
    });

    expect(await missing.uow.start(startCommand({ cycleId: 1 }))).toEqual({
      kind: 'timeline_not_found',
    });
    expect(await elsewhere.uow.start(startCommand({ cycleId: 1 }))).toEqual({
      kind: 'timeline_not_found',
    });
    expect(writes(inTransaction(missing.log))).toEqual([]);
    expect(writes(inTransaction(elsewhere.log))).toEqual([]);
  });

  it('a lost fence (the mark matches no row) rolls the start back, with no commit', async () => {
    const { uow, log } = stub({ fenceRows: 0 });

    await expect(
      uow.start(startCommand({ cycleId: 1, reservation })),
    ).rejects.toBeInstanceOf(IdempotencyFenceLostError);

    expect(log.some((s) => s.sql === 'commit')).toBe(false);
    expect(inTransaction(log).at(-1)!.sql).toBe('rollback');
  });
});

describe('the lot, the end and the end of expired memberships over a stub MySQL driver (design 7.3)', () => {
  it('a lot: READ COMMITTED, the load row FOR UPDATE, one INSERT per membership, then the progress, the heartbeat and the summary, one commit', async () => {
    const { uow, log } = stub();

    const result = await uow.recordLot(lotCommand(41, [5120, 5121]));

    expect(result).toEqual({
      kind: 'recorded',
      insertedCodes: [5120, 5121],
      raceSkips: [],
      processed: 2,
    });
    expect(log.slice(0, 2).map((s) => s.sql)).toEqual([
      'set transaction isolation level read committed',
      'begin',
    ]);
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.via)).toEqual(inTx.map(() => 'tx'));
    expect(inTx.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'select `id`, `cycle_id`,',
      'select `status`, `year`',
      'select `id` from',
      'select `id`, `cycle_id`,',
      'insert into `timeline_results`',
      'insert into `timeline_results`',
      'update `timeline_loads` set',
      'commit',
    ]);
    // The start's lock order before any write (the deadlock of a lot against a start).
    expectLoadLockOrder(inTx, { loadId: 41, cycleId: 1, timelineId: 11 });
    // The generated key is never written; the cycle, timeline, load and phase year are the load's.
    expect(inTx[5]!.sql).not.toContain('active_key');
    expect(inTx[5]!.params).toEqual(
      expect.arrayContaining([1, 11, 41, 5120, 6120, 2026, 2, 'KP', 'pending']),
    );
    const progress = inTx[7]!;
    expect(progress.sql).toMatch(
      /^update `timeline_loads` set `processed` = \?, `summary` = \?, `heartbeat_at` = \? where `timeline_loads`\.`id` = \?$/,
    );
    expect(progress.params).toEqual([
      2,
      '{"loaded":2,"byProgram":{"2":2},"byType":{"KP":2},"kpGroups":{},"skipped":{},"otherTimelines":{}}',
      '2026-11-10 08:00:00.000',
      41,
    ]);
  });

  it('a duplicate on a key is a skip and the lot goes on: the key named picks the reason, and the blocker is read to be named', async () => {
    const { uow, log } = stub({
      membershipError: (attempt) =>
        attempt === 1
          ? duplicate('timeline_results.uq_timeline_results_active_key')
          : attempt === 2
            ? duplicate('timeline_results.uq_timeline_results_timeline_code')
            : undefined,
      memberships: [[7, 5120, 12, null]],
      lastSteps: [[12, 'August 2026', '2026-12-18 17:30:00']],
    });

    const result = await uow.recordLot(lotCommand(41, [5120, 5121, 5122]));

    expect(result).toEqual({
      kind: 'recorded',
      insertedCodes: [5122],
      raceSkips: [
        {
          resultCode: 5120,
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          timelineId: 12,
        },
        { resultCode: 5121, reason: 'ALREADY_IN_THIS_TIMELINE' },
      ],
      processed: 3,
    });
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'select `id`, `cycle_id`,',
      'select `status`, `year`',
      'select `id` from',
      'select `id`, `cycle_id`,',
      'insert into `timeline_results`',
      'select `id`, `result_code`,',
      'select `timeline_steps`.`timeline_id`, `timelines`.`name`,',
      'insert into `timeline_results`',
      'insert into `timeline_results`',
      'update `timeline_loads` set',
      'commit',
    ]);
    const summary = JSON.parse(inTx.at(-2)!.params[1] as string) as unknown;
    expect(summary).toEqual({
      loaded: 1,
      byProgram: { '2': 1 },
      byType: { KP: 1 },
      kpGroups: {},
      skipped: { ACTIVE_IN_OTHER_TIMELINE: 1, ALREADY_IN_THIS_TIMELINE: 1 },
      otherTimelines: { '12': { name: 'August 2026', count: 1 } },
    });
  });

  it('any other error in a lot (a deadlock) is thrown and rolls the whole lot back: no progress is written', async () => {
    const { uow, log } = stub({
      membershipError: (attempt) =>
        attempt === 2
          ? Object.assign(new Error('Deadlock found'), {
              code: 'ER_LOCK_DEADLOCK',
              errno: 1213,
            })
          : undefined,
    });

    await expect(
      uow.recordLot(lotCommand(41, [5120, 5121])),
    ).rejects.toMatchObject({ cause: { code: 'ER_LOCK_DEADLOCK' } });

    const inTx = inTransaction(log);
    expect(inTx.at(-1)!.sql).toBe('rollback');
    expect(log.some((s) => s.sql.startsWith('update `timeline_loads`'))).toBe(
      false,
    );
  });

  it('a lot of a load that is no longer running writes nothing', async () => {
    const { uow, log } = stub({
      locked: [
        loadValues({
          id: 41,
          timelineId: 11,
          status: 'failed',
          heartbeatAt: stamp,
        }),
      ],
    });

    const result = await uow.recordLot(lotCommand(41, [5120]));

    expect(result).toEqual({ kind: 'load_not_running', status: 'failed' });
    expect(writes(inTransaction(log))).toEqual([]);
  });

  it('the end of a load: the load row FOR UPDATE, the conditional UPDATE on status running, the load_end row, one commit', async () => {
    const { uow, log } = stub({
      locked: [
        loadValues({
          id: 41,
          timelineId: 11,
          heartbeatAt: stamp,
          processed: 120,
          summary: {
            loaded: 100,
            skipped: {
              ACTIVE_IN_OTHER_TIMELINE: 15,
              ALREADY_IN_THIS_TIMELINE: 5,
            },
          },
        }),
      ],
    });

    const result = await uow.end({
      loadId: 41,
      status: 'failed',
      failureReason: 'REPORTING_UNAVAILABLE',
      now: NOW,
    });

    expect(result).toEqual({ kind: 'ended' });
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'select `id`, `cycle_id`,',
      'select `status`, `year`',
      'select `id` from',
      'select `id`, `cycle_id`,',
      'update `timeline_loads` set',
      'insert into `timeline_audit_events`',
      'commit',
    ]);
    // The audit row's foreign key takes S on the timeline: locked before the load row.
    expectLoadLockOrder(inTx, { loadId: 41, cycleId: 1, timelineId: 11 });
    expect(inTx[5]!.sql).toMatch(
      /where \(`timeline_loads`\.`id` = \? and `timeline_loads`\.`status` = \?\)$/,
    );
    expect(inTx[5]!.params).toEqual([
      'failed',
      'REPORTING_UNAVAILABLE',
      '2026-11-10 08:00:00.000',
      41,
      'running',
    ]);
    // The starter is the actor, the load's own request id is kept (design 5.3).
    expect(inTx[6]!.params).toEqual([
      11,
      9,
      'load_end',
      '{"load":{"before":"running","after":{"id":41,"status":"failed","total":120,"processed":120,"loaded":100,"skipped":20,"failureReason":"REPORTING_UNAVAILABLE"}}}',
      'req-0',
      '2026-11-10 08:00:00.000',
    ]);
  });

  it('a conditional UPDATE that matches no row (the load ended meanwhile) writes no audit row', async () => {
    const { uow, log } = stub({ endRows: 0 });

    const result = await uow.end({ loadId: 41, status: 'completed', now: NOW });

    expect(result).toEqual({ kind: 'load_not_running', status: 'running' });
    expect(
      log.some((s) => s.sql.startsWith('insert into `timeline_audit_events`')),
    ).toBe(false);
  });

  it('a lot or an end of a load that does not exist takes no lock: the plain read finds nothing and the transaction ends empty', async () => {
    const { uow, log } = stub({ locked: [] });

    expect(await uow.recordLot(lotCommand(99, [5120]))).toEqual({
      kind: 'load_not_found',
    });
    expect(
      await uow.end({ loadId: 99, status: 'completed', now: NOW }),
    ).toEqual({ kind: 'load_not_found' });

    expect(log.filter((s) => /for (share|update)$/.test(s.sql))).toEqual([]);
    expect(writes(log)).toEqual([]);
  });

  it('ending expired memberships is one UPDATE of ended_at and end_reason on rows still active, in one transaction', async () => {
    const { uow, log } = stub();

    const result = await uow.endExpired({
      timelineId: 11,
      now: NOW,
      memberships: [
        {
          id: 7,
          resultCode: 5120,
          timelineId: 12,
          timelineName: 'August 2026',
          endedAt: null,
          lastStepClosesAt: minute('2026-11-09T17:30'),
        },
        {
          id: 8,
          resultCode: 5121,
          timelineId: 12,
          timelineName: 'August 2026',
          endedAt: null,
          lastStepClosesAt: minute('2026-11-09T17:30'),
        },
      ],
    });

    expect(result).toEqual({ ended: 1 + 1 });
    const inTx = inTransaction(log);
    expect(inTx.map((s) => s.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'update `timeline_results` set',
      'commit',
    ]);
    expect(inTx[1]!.sql).toMatch(
      /^update `timeline_results` set `ended_at` = \?, `end_reason` = \? where \(`timeline_results`\.`id` in \(\?, \?\) and `timeline_results`\.`ended_at` is null\)$/,
    );
    expect(inTx[1]!.params).toEqual([
      '2026-11-10 08:00:00.000',
      'timeline_closed',
      7,
      8,
    ]);
  });

  it('with nothing to end no statement runs at all', async () => {
    const { uow, log } = stub();

    expect(
      await uow.endExpired({ timelineId: 11, now: NOW, memberships: [] }),
    ).toEqual({ ended: 0 });
    expect(log).toEqual([]);
  });
});

describe('LoadsStore reads over a stub MySQL driver (design 7.1 step 3, FR-10)', () => {
  it('memberships by codes: IN is chunked by 500, a repeated code is asked once, and the names and last steps come in one more statement', async () => {
    const { store, log } = stub({
      memberships: [
        [8, 5121, 12, null],
        [7, 5120, 12, '2026-11-09 08:00:00'],
      ],
      lastSteps: [[12, 'August 2026', '2026-12-18 17:30:00']],
    });
    const codes = Array.from({ length: 1200 }, (_, i) => 5000 + i);

    const rows = await store.findMemberships(1, [...codes, 5000]);

    const reads = log.filter((s) => s.sql.includes('from `timeline_results`'));
    // One cycle id plus the codes of the chunk.
    expect(reads.map((s) => s.params.length)).toEqual([501, 501, 201]);
    expect(reads.every((s) => s.via === 'pool')).toBe(true);
    expect(reads[0]!.params[0]).toBe(1);
    expect(
      log.filter((s) => s.sql.includes('from `timeline_steps` inner join')),
    ).toHaveLength(1);
    expect(log).toHaveLength(4 + 0);
    expect(rows).toEqual([
      {
        id: 7,
        resultCode: 5120,
        timelineId: 12,
        timelineName: 'August 2026',
        endedAt: new Date('2026-11-09T08:00:00.000Z'),
        lastStepClosesAt: '2026-12-18T17:30',
      },
      {
        id: 8,
        resultCode: 5121,
        timelineId: 12,
        timelineName: 'August 2026',
        endedAt: null,
        lastStepClosesAt: '2026-12-18T17:30',
      },
    ]);
  });

  it('no membership found: only the chunks run, no read of the steps', async () => {
    const { store, log } = stub();

    expect(await store.findMemberships(1, [5120, 5121])).toEqual([]);
    expect(await store.findMemberships(1, [])).toEqual([]);

    expect(log.map((s) => /from `(\w+)`/.exec(s.sql)![1])).toEqual([
      'timeline_results',
    ]);
  });

  it('the loads of a timeline are one statement on the pool, newest first, with who started each', async () => {
    const { store, log } = stub({
      loadList: [
        [...loadValues({ id: 41, timelineId: 11, heartbeatAt: stamp }), 'ana'],
      ],
    });

    const rows = await store.listByTimeline(11);

    expect(log).toHaveLength(1);
    expect(log[0]!.via).toBe('pool');
    expect(log[0]!.sql).toMatch(
      /inner join `users` on `users`\.`id` = `timeline_loads`\.`started_by` where `timeline_loads`\.`timeline_id` = \? order by `timeline_loads`\.`id` desc$/,
    );
    expect(log[0]!.params).toEqual([11]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      load: { id: 41, timelineId: 11, status: 'running', processed: 0 },
      startedBy: { id: 9, nickname: 'ana' },
    });
  });
});

// --- the in-memory world: the keys, the locks and the interleavings ----------

describe('start over the in-memory world (FR-2, DD-7)', () => {
  it('a start inserts one running load of step 1 with the scope and phase year read at start, bumps the version once and writes the load_start row', async () => {
    const { world, uow, transactions } = inMemory();

    const result = await uow.start(startCommand());

    expect(result).toEqual({
      kind: 'started',
      loadId: 1,
      abandonedLoadIds: [],
    });
    expect(world.loads).toEqual([
      {
        id: 1,
        cycleId: 1,
        timelineId: 11,
        timelineStepId: 111,
        phaseYear: 2026,
        scope: SCOPE,
        status: 'running',
        runningKey: 1,
        total: null,
        processed: 0,
        summary: {
          loaded: 0,
          byProgram: {},
          byType: {},
          kpGroups: {},
          skipped: {},
          otherTimelines: {},
        },
        failureReason: null,
        startedBy: 9,
        startedAt: NOW,
        heartbeatAt: NOW,
        finishedAt: null,
        requestId: 'req-1',
      },
    ]);
    // FR-2, "Start": the timeline's version goes up by one, and only that row changes.
    expect(version(world, 11)).toBe(5);
    expect(version(world, 12)).toBe(1);
    expect(world.admin.timelines.find((t) => t.id === 11)).toMatchObject({
      updatedAt: null,
      updatedBy: null,
    });
    expect(world.history).toEqual([
      'load:insert:1',
      'version:11',
      'audit:load_start:11',
    ]);
    expect([transactions.committed, transactions.rolledBack]).toEqual([1, 0]);
  });

  it('the load_start row: one row, the actor, the timeline, and { load: { before: null, after: { id, phaseYear, scope } } }', async () => {
    const { world, uow } = inMemory();

    await uow.start(startCommand({ requestId: 'req-7' }));

    expect(world.admin.auditEvents).toEqual([
      {
        id: 1,
        timelineId: 11,
        actorId: 9,
        action: 'load_start',
        changes: {
          load: {
            before: null,
            after: { id: 1, phaseYear: 2026, scope: SCOPE },
          },
        },
        requestId: 'req-7',
        createdAt: NOW,
      },
    ]);
  });

  it('the scope of an all-programs timeline is the flag with no list', async () => {
    const world = seedWorld();
    const row = world.admin.timelines.find((t) => t.id === 12)!;
    row.allPrograms = true;
    world.admin.programs.splice(
      0,
      world.admin.programs.length,
      ...world.admin.programs.filter((p) => p.timelineId !== 12),
    );
    const { uow } = inMemory(world);

    await uow.start(startCommand({ timelineId: 12 }));

    expect(world.loads[0]!.scope).toEqual({
      allPrograms: true,
      programIds: [],
      allResultTypes: false,
      resultTypeKeys: ['KP'],
    });
  });

  it('two starts of one timeline at the same moment: one load is started and the other is LOADS_ALREADY_RUNNING, refused by the running_key and not by a read', async () => {
    const { world, uow, transactions } = inMemory();

    const results = await Promise.all([
      uow.start(startCommand()),
      uow.start(startCommand()),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual([
      'already_running',
      'started',
    ]);
    expect(world.loads).toHaveLength(1);
    expect(world.loads.filter((l) => l.status === 'running')).toHaveLength(1);
    // The database refused the second insert: the fake counts it.
    expect(world.violations.runningKey).toBe(1);
    // One bump, one audit row: the loser wrote nothing.
    expect(version(world, 11)).toBe(5);
    expect(auditOf(world, 'load_start')).toHaveLength(1);
    expect([transactions.committed, transactions.rolledBack]).toEqual([1, 1]);
  });

  it('two starts of two timelines of one cycle at the same moment: both read "none running" and only the unique key decides, so exactly one load runs', async () => {
    const { world, uow } = inMemory();

    const results = await Promise.all([
      uow.start(startCommand({ timelineId: 11 })),
      uow.start(startCommand({ timelineId: 12 })),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual([
      'already_running',
      'started',
    ]);
    expect(world.loads).toHaveLength(1);
    expect(world.violations.runningKey).toBe(1);
    // Only the winner's timeline moved.
    const bumped = [11, 12].filter(
      (id) => version(world, id) > (id === 11 ? 4 : 1),
    );
    expect(bumped).toEqual([world.loads[0]!.timelineId]);
    expect(world.history.filter((h) => h.startsWith('load:insert'))).toEqual([
      'load:insert:1',
    ]);
  });

  it('five starts of one cycle at the same moment: one load', async () => {
    const { world, uow } = inMemory();

    const results = await Promise.all(
      [11, 12, 13, 11, 12].map((timelineId) =>
        uow.start(startCommand({ timelineId })),
      ),
    );

    expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'already_running')).toHaveLength(4);
    expect(world.loads).toHaveLength(1);
  });

  it('starts of two cycles at the same moment both run: the key is per cycle', async () => {
    const { world, uow } = inMemory();

    const results = await Promise.all([
      uow.start(startCommand({ cycleId: 1, timelineId: 11 })),
      uow.start(startCommand({ cycleId: 2, timelineId: 21 })),
    ]);

    expect(results.map((r) => r.kind)).toEqual(['started', 'started']);
    expect(world.loads.map((l) => [l.cycleId, l.runningKey])).toEqual(
      expect.arrayContaining([
        [1, 1],
        [2, 2],
      ]),
    );
    expect(world.violations.runningKey).toBe(0);
  });

  it('a finished load does not block a new start', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 12, status: 'completed' }),
      loadRow({ id: 6, timelineId: 13, status: 'failed' }),
    );
    const { uow } = inMemory(world);

    const result = await uow.start(startCommand());

    expect(result).toMatchObject({ kind: 'started', loadId: 7 });
  });

  it('a stale running load becomes failed/ABANDONED inside the start, with its load_end row, and the new load starts (FR-9, DD-6)', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({
        id: 5,
        timelineId: 12,
        heartbeatAt: ago(6 * MINUTE),
        total: 1200,
        processed: 275,
        summary: {
          loaded: 250,
          byProgram: {},
          byType: {},
          kpGroups: {},
          skipped: {
            ALREADY_IN_THIS_TIMELINE: 20,
            ACTIVE_IN_OTHER_TIMELINE: 5,
          },
          otherTimelines: {},
        },
      }),
    );
    const { uow } = inMemory(world);

    const result = await uow.start(startCommand());

    expect(result).toEqual({
      kind: 'started',
      loadId: 6,
      abandonedLoadIds: [5],
    });
    expect(world.loads.find((l) => l.id === 5)).toMatchObject({
      status: 'failed',
      failureReason: 'ABANDONED',
      runningKey: null,
      finishedAt: NOW,
      // What it had recorded stays (FR-8).
      total: 1200,
      processed: 275,
    });
    expect(world.loads.find((l) => l.id === 6)).toMatchObject({
      status: 'running',
      timelineId: 11,
    });
    // The old load's end, then the new load's start, in one transaction.
    expect(world.history).toEqual([
      'load:end:5:failed',
      'audit:load_end:12',
      'load:insert:6',
      'version:11',
      'audit:load_start:11',
    ]);
    expect(auditOf(world, 'load_end')).toEqual([
      {
        id: 1,
        // The abandoned load's own timeline, and the user who started it.
        timelineId: 12,
        actorId: 9,
        action: 'load_end',
        changes: {
          load: {
            before: 'running',
            after: {
              id: 5,
              status: 'failed',
              total: 1200,
              processed: 275,
              loaded: 250,
              skipped: 25,
              failureReason: 'ABANDONED',
            },
          },
        },
        requestId: 'req-1',
        createdAt: NOW,
      },
    ]);
  });

  it('the lease is strict: a heartbeat of exactly 5 minutes is alive (the start is refused), 5 minutes and a second is not (FR-9)', async () => {
    const alive = seedWorld();
    alive.loads.push(
      loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(5 * MINUTE) }),
    );
    const stale = seedWorld();
    stale.loads.push(
      loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(5 * MINUTE + 1000) }),
    );

    const refused = await inMemory(alive).uow.start(startCommand());
    const accepted = await inMemory(stale).uow.start(startCommand());

    expect(refused).toEqual({ kind: 'already_running' });
    expect(alive.loads).toHaveLength(1);
    expect(alive.loads[0]).toMatchObject({ status: 'running' });
    // The refusal rolled back everything, the version included.
    expect(version(alive, 11)).toBe(4);
    expect(alive.admin.auditEvents).toEqual([]);
    expect(accepted).toMatchObject({ kind: 'started', abandonedLoadIds: [5] });
  });

  it('two starts at once over a stale load: the first ends it and starts, the second finds the new load alive and is refused, and the stale load has one load_end row', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 13, heartbeatAt: ago(10 * MINUTE) }),
    );
    const { uow } = inMemory(world);

    const results = await Promise.all([
      uow.start(startCommand({ timelineId: 11 })),
      uow.start(startCommand({ timelineId: 12 })),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual([
      'already_running',
      'started',
    ]);
    expect(world.loads.map((l) => [l.id, l.status])).toEqual([
      [5, 'failed'],
      [6, 'running'],
    ]);
    expect(auditOf(world, 'load_end')).toHaveLength(1);
    expect(auditOf(world, 'load_start')).toHaveLength(1);
  });

  it('a closed cycle, a closed window and an unknown timeline are refused with no write at all', async () => {
    const closedCycle = seedWorld();
    closedCycle.admin.cycles[0] = cycleRow(1, 'closed');
    const late = inMemory();
    const missing = inMemory();

    expect(await inMemory(closedCycle).uow.start(startCommand())).toEqual({
      kind: 'cycle_closed',
    });
    // 16:31Z on 20 Nov is 17:31 in Rome, one minute after step 1 closes.
    expect(
      await late.uow.start(
        startCommand({ now: new Date('2026-11-20T16:31:00.000Z') }),
      ),
    ).toEqual({ kind: 'window_closed' });
    expect(await missing.uow.start(startCommand({ timelineId: 99 }))).toEqual({
      kind: 'timeline_not_found',
    });
    expect(await missing.uow.start(startCommand({ cycleId: 2 }))).toEqual({
      kind: 'timeline_not_found',
    });

    for (const world of [closedCycle, late.world, missing.world]) {
      expect(world.loads).toEqual([]);
      expect(world.history).toEqual([]);
      expect(world.admin.auditEvents).toEqual([]);
    }
    expect(version(late.world, 11)).toBe(4);
  });

  it('the closing minute is still open: 17:30 Rome starts (FR-2, "window closed")', async () => {
    const { world, uow } = inMemory();

    const result = await uow.start(
      startCommand({ now: new Date('2026-11-20T16:30:59.000Z') }),
    );

    expect(result.kind).toBe('started');
    expect(world.loads).toHaveLength(1);
  });

  it('a keyed start marks its key executed in the same transaction, with the load id as the target', async () => {
    const { world, uow } = inMemory();
    const clock = new FakeClock();
    const store = world.admin.base.idempotencyStore(clock.now);
    const reserved = await store.reserve({
      actorId: 9,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 202,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');

    const result = await uow.start(
      startCommand({ reservation: reserved.reservation }),
    );

    expect(result).toMatchObject({ kind: 'started', loadId: 1 });
    expect(store.peek(9, 'key-1')).toMatchObject({
      state: 'executed',
      targetUserId: 1,
    });
  });

  it('a refused start does not mark the key', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 5, timelineId: 12 }));
    const { uow } = inMemory(world);
    const store = world.admin.base.idempotencyStore(new FakeClock().now);
    const reserved = await store.reserve({
      actorId: 9,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 202,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');

    const result = await uow.start(
      startCommand({ reservation: reserved.reservation }),
    );

    expect(result).toEqual({ kind: 'already_running' });
    expect(store.peek(9, 'key-1')).toMatchObject({ state: 'in_progress' });
  });

  it('a start that lost its key to a take-over rolls back the load, the version and the audit row', async () => {
    const { world, uow, transactions } = inMemory();
    const store = world.admin.base.idempotencyStore(new FakeClock().now);
    const reserved = await store.reserve({
      actorId: 9,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 202,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');
    // Another request took the key over: the owner token is no longer ours.
    store.seed({ ...store.peek(9, 'key-1')!, ownerToken: 'someone-else' });

    await expect(
      uow.start(startCommand({ reservation: reserved.reservation })),
    ).rejects.toBeInstanceOf(IdempotencyFenceLostError);

    expect(world.loads).toEqual([]);
    expect(version(world, 11)).toBe(4);
    expect(world.admin.auditEvents).toEqual([]);
    expect([transactions.committed, transactions.rolledBack]).toEqual([0, 1]);
  });
});

describe('start against the timeline edit (DD-7, P-8, FR-11)', () => {
  /** What the edit's transaction does first: the cycle FOR SHARE, the timeline FOR UPDATE, the version compared to the one the request named. */
  const edit =
    (expectedVersion: number, change?: { programIds: number[] }) =>
    async (repositories: TimelinesRepositories) => {
      const { timelines } = repositories;
      await timelines.lockCycleShared(1);
      const locked = await timelines.findForUpdate(11);
      if (!locked || locked.version !== expectedVersion) {
        return { kind: 'stale' as const, seen: locked?.version };
      }
      await timelines.updateTimeline(11, expectedVersion, {
        updatedAt: NOW,
        updatedBy: 9,
      });
      if (change) {
        await timelines.replacePrograms(11, change.programIds);
      }
      return { kind: 'updated' as const, seen: locked.version };
    };

  it('an edit that read version 4 and waits for the timeline lock finds the version moved by the start, and is stale', async () => {
    const { world, uow } = inMemory();
    const timelineUow = new InMemoryTimelinesUnitOfWork(world.admin);

    // The start asks first and holds the timeline row until it commits.
    const [started, edited] = await Promise.all([
      uow.start(startCommand()),
      timelineUow.run(edit(4, { programIds: [2, 3] })),
    ]);

    expect(started.kind).toBe('started');
    expect(edited).toEqual({ kind: 'stale', seen: 5 });
    // The load read the scope the timeline had, and the edit changed nothing.
    expect(world.loads[0]!.scope.programIds).toEqual([2]);
    expect(
      world.admin.programs
        .filter((p) => p.timelineId === 11)
        .map((p) => p.programId),
    ).toEqual([2]);
    expect(version(world, 11)).toBe(5);
  });

  it('an edit that commits first: the start waits, reads the new scope, and bumps the version after the edit', async () => {
    const { world, uow } = inMemory();
    const timelineUow = new InMemoryTimelinesUnitOfWork(world.admin);

    const [edited, started] = await Promise.all([
      timelineUow.run(edit(4, { programIds: [2, 3] })),
      uow.start(startCommand()),
    ]);

    expect(edited).toEqual({ kind: 'updated', seen: 4 });
    expect(started.kind).toBe('started');
    // FR-11, "load and edit race": the load starts with the new scope.
    expect(world.loads[0]!.scope.programIds).toEqual([2, 3]);
    expect(version(world, 11)).toBe(6);
  });
});

/**
 * The fake has no deadlock detector: a transaction caught in a lock cycle waits
 * for ever. Every statement of the fake takes a few event-loop turns, so a run
 * still pending after this long is a lock cycle, which InnoDB answers with
 * error 1213 for one of the two (a 500 where the start owes a 409).
 */
async function withoutDeadlock<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'DEADLOCK: the transactions wait for each other (InnoDB answers ER_LOCK_DEADLOCK 1213)',
          ),
        ),
      1000,
    );
  });
  try {
    return await Promise.race([work, stuck]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Two transactions begun `lag` round trips apart: positive, the second one is
 * behind; negative, the first one. Every statement is a round trip, so the lag
 * decides which statement of one meets which statement of the other.
 */
function race<A, B>(
  lag: number,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const behind = async <T>(turns: number, run: () => Promise<T>) => {
    for (let turn = 0; turn < turns; turn++) await roundTrip();
    return run();
  };
  return withoutDeadlock(
    Promise.all([
      behind(Math.max(-lag, 0), first),
      behind(Math.max(lag, 0), second),
    ]),
  );
}

describe('a start against the lot and the end of the load it finds running (lock order, DD-9, P-8, FR-2)', () => {
  // A membership and an audit row take S on the timeline row (their foreign
  // keys). A lot or an end that took the load row first and the timeline after
  // would wait for a start that holds the timeline FOR UPDATE and waits for that
  // load row. The lag runs the two transactions against each other at every
  // statement, in both orders, so the order that deadlocks cannot slip through.
  const lags = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

  it.each(lags)(
    'start of timeline 11 against a lot of its own running load (lag %i): the start is LOADS_ALREADY_RUNNING, the lot is recorded and nothing waits for ever',
    async (lag) => {
      const world = seedWorld();
      world.loads.push(loadRow({ id: 1, timelineId: 11 }));
      const { uow } = inMemory(world);

      const [start, lot] = await race(
        lag,
        () => uow.start(startCommand({ timelineId: 11 })),
        () => uow.recordLot(lotCommand(1, [5120, 5121])),
      );

      expect(start).toEqual({ kind: 'already_running' });
      expect(lot).toMatchObject({
        kind: 'recorded',
        insertedCodes: [5120, 5121],
        processed: 2,
      });
      expect(world.results.map((r) => r.resultCode)).toEqual([5120, 5121]);
      expect(world.loads).toHaveLength(1);
      expect(world.loads[0]).toMatchObject({ status: 'running', processed: 2 });
      // The refused start left nothing behind.
      expect(version(world, 11)).toBe(4);
      expect(auditOf(world, 'load_start')).toEqual([]);
    },
  );

  it.each(lags)(
    'start of timeline 11 against the end of its own running load (lag %i): the end is recorded once and the start is refused or accepted, never an error',
    async (lag) => {
      const world = seedWorld();
      world.loads.push(loadRow({ id: 1, timelineId: 11, processed: 5 }));
      const { uow } = inMemory(world);

      const [start, end] = await race(
        lag,
        () => uow.start(startCommand({ timelineId: 11 })),
        () => uow.end({ loadId: 1, status: 'completed', now: NOW }),
      );

      expect(end).toEqual({ kind: 'ended' });
      // Refused while the load still ran, accepted once it had ended.
      expect(['already_running', 'started']).toContain(start.kind);
      expect(world.loads.find((l) => l.id === 1)).toMatchObject({
        status: 'completed',
        runningKey: null,
      });
      expect(world.loads.filter((l) => l.status === 'running')).toHaveLength(
        start.kind === 'started' ? 1 : 0,
      );
      expect(auditOf(world, 'load_end')).toHaveLength(1);
      expect(auditOf(world, 'load_end')[0]!.changes).toMatchObject({
        load: { after: { id: 1, status: 'completed' } },
      });
    },
  );

  it.each(lags)(
    'start of timeline 11 abandons a stale load of timeline 12 while timeline 12 starts too (lag %i): one is started, the other is refused, and the stale load has one load_end row',
    async (lag) => {
      // The abandon writes a load_end row for timeline 12, whose foreign key
      // takes S on the row that the start of timeline 12 holds FOR UPDATE.
      const world = seedWorld();
      world.loads.push(
        loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(6 * MINUTE) }),
      );
      const { uow } = inMemory(world);

      const [fromEleven, fromTwelve] = await race(
        lag,
        () => uow.start(startCommand({ timelineId: 11 })),
        () => uow.start(startCommand({ timelineId: 12 })),
      );

      expect([fromEleven.kind, fromTwelve.kind].sort()).toEqual([
        'already_running',
        'started',
      ]);
      expect(world.loads.map((l) => [l.id, l.status])).toEqual([
        [5, 'failed'],
        [6, 'running'],
      ]);
      expect(auditOf(world, 'load_end')).toHaveLength(1);
      expect(auditOf(world, 'load_start')).toHaveLength(1);
    },
  );
});

describe('the lot over the in-memory world (FR-3, FR-4, FR-9)', () => {
  it('a lot inserts its memberships as active members of the load, then advances processed, the heartbeat and the summary together', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 1, timelineId: 11, heartbeatAt: ago(2 * MINUTE) }),
    );
    const { uow } = inMemory(world);

    const result = await uow.recordLot(
      lotCommand(1, [5120, 5121, 5122], {
        processed: 5,
        memberships: [
          lotMember(5120),
          lotMember(5121, {
            programClarisaId: 3,
            resultTypeKey: 'KP',
            status: 'auto_validated',
            kpGroup: 'auto_checked',
            awaitsStep: null,
          }),
          lotMember(5122, {
            resultTypeKey: 'POLICY',
            status: 'not_in_qa',
            kpGroup: 'not_in_qa',
          }),
        ],
        skips: {
          skipped: { not_submitted: 1, ACTIVE_IN_OTHER_TIMELINE: 1 },
          otherTimelines: { '12': { name: 'August 2026', count: 1 } },
        },
      }),
    );

    expect(result).toEqual({
      kind: 'recorded',
      insertedCodes: [5120, 5121, 5122],
      raceSkips: [],
      processed: 5,
    });
    expect(
      world.results.map((r) => [
        r.resultCode,
        r.timelineId,
        r.loadId,
        r.activeKey,
      ]),
    ).toEqual([
      [5120, 11, 1, '1#5120'],
      [5121, 11, 1, '1#5121'],
      [5122, 11, 1, '1#5122'],
    ]);
    expect(world.results[0]).toMatchObject({
      cycleId: 1,
      phaseYear: 2026,
      resultId: 6120,
      programClarisaId: 2,
      resultTypeKey: 'KP',
      status: 'pending',
      kpGroup: null,
      createdAt: NOW,
      endedAt: null,
      endReason: null,
    });
    expect(world.loads[0]).toMatchObject({
      processed: 5,
      heartbeatAt: NOW,
      status: 'running',
      summary: {
        loaded: 3,
        byProgram: { '2': 2, '3': 1 },
        byType: { KP: 2, POLICY: 1 },
        kpGroups: { auto_checked: 1, not_in_qa: 1 },
        skipped: { not_submitted: 1, ACTIVE_IN_OTHER_TIMELINE: 1 },
        otherTimelines: { '12': { name: 'August 2026', count: 1 } },
      },
    });
  });

  it('a second lot adds to the first: processed and every count merge, and the load keeps running', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 1, timelineId: 11 }));
    const { uow } = inMemory(world);

    await uow.recordLot(lotCommand(1, [5120, 5121], { processed: 50 }));
    const second = await uow.recordLot(
      lotCommand(1, [5122], {
        processed: 50,
        skips: { skipped: { not_submitted: 4 }, otherTimelines: {} },
        now: new Date(NOW.getTime() + MINUTE),
      }),
    );

    expect(second).toMatchObject({ kind: 'recorded', processed: 100 });
    expect(world.loads[0]).toMatchObject({
      processed: 100,
      heartbeatAt: new Date(NOW.getTime() + MINUTE),
      summary: {
        loaded: 3,
        byProgram: { '2': 3 },
        byType: { KP: 3 },
        skipped: { not_submitted: 4 },
      },
    });
  });

  it('a result another timeline holds active is skipped by the active_key, the timeline is named, and the lot goes on (FR-4, "collision")', async () => {
    const world = seedWorld();
    // 5120 is active in timeline 12 (its load finished); this lot's read missed it.
    world.loads.push(
      loadRow({ id: 1, timelineId: 11 }),
      loadRow({ id: 2, timelineId: 12, status: 'completed' }),
    );
    world.results.push(
      memberRow({ id: 1, timelineId: 12, resultCode: 5120, loadId: 2 }),
    );
    const { uow } = inMemory(world);

    const result = await uow.recordLot(lotCommand(1, [5119, 5120, 5121]));

    expect(result).toEqual({
      kind: 'recorded',
      insertedCodes: [5119, 5121],
      raceSkips: [
        {
          resultCode: 5120,
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          timelineId: 12,
        },
      ],
      processed: 3,
    });
    expect(world.violations).toEqual({
      runningKey: 0,
      activeKey: 1,
      timelineCode: 0,
    });
    expect(world.results.filter((r) => r.resultCode === 5120)).toHaveLength(1);
    expect(world.loads[0]!.summary).toMatchObject({
      loaded: 2,
      skipped: { ACTIVE_IN_OTHER_TIMELINE: 1 },
      otherTimelines: { '12': { name: 'August 2026', count: 1 } },
    });
  });

  it('a result already a member of this timeline is skipped by the timeline key, also after its membership ended (FR-4, S-5)', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 1, timelineId: 11 }));
    world.results.push(
      memberRow({ id: 1, timelineId: 11, resultCode: 5120 }),
      memberRow({
        id: 2,
        timelineId: 11,
        resultCode: 5121,
        endedAt: ago(MINUTE),
        endReason: 'released_qaed',
      }),
    );
    const { uow } = inMemory(world);

    const result = await uow.recordLot(lotCommand(1, [5120, 5121, 5122]));

    expect(result).toMatchObject({
      kind: 'recorded',
      insertedCodes: [5122],
      raceSkips: [
        { resultCode: 5120, reason: 'ALREADY_IN_THIS_TIMELINE' },
        { resultCode: 5121, reason: 'ALREADY_IN_THIS_TIMELINE' },
      ],
    });
    expect(world.violations.timelineCode).toBe(2);
    expect(world.loads[0]!.summary).toMatchObject({
      loaded: 1,
      skipped: { ALREADY_IN_THIS_TIMELINE: 2 },
    });
  });

  it('two lots inserting the same code in one cycle at the same moment: one membership, one skip, judged by the key the database refused (FR-4, "race")', async () => {
    const world = seedWorld();
    // Two loads of two timelines of one cycle both `running`: the one state the
    // running_key forbids, built directly, because it is the only one in which
    // two lots can overlap. The unique keys are the second line behind it.
    world.loads.push(
      loadRow({ id: 1, timelineId: 11 }),
      loadRow({ id: 2, timelineId: 12 }),
    );
    world.loads[1]!.runningKey = null;
    const { uow } = inMemory(world);

    const [first, second] = await Promise.all([
      uow.recordLot(lotCommand(1, [5120, 5121])),
      uow.recordLot(lotCommand(2, [5120, 5122])),
    ]);

    expect(world.results.filter((r) => r.resultCode === 5120)).toHaveLength(1);
    expect(
      world.results.map((r) => r.resultCode).sort((a, b) => a - b),
    ).toEqual([5120, 5121, 5122]);
    const skips = [first, second].flatMap((r) =>
      r.kind === 'recorded' ? r.raceSkips : [],
    );
    expect(skips).toHaveLength(1);
    // The loser is the other timeline's lot: the cycle-wide key refused it.
    const loserTimeline = skips[0]!.timelineId;
    expect(skips[0]).toMatchObject({
      resultCode: 5120,
      reason: 'ACTIVE_IN_OTHER_TIMELINE',
    });
    expect(loserTimeline).toBe(
      world.results.find((r) => r.resultCode === 5120)!.timelineId,
    );
    expect(world.violations).toEqual({
      runningKey: 0,
      activeKey: 1,
      timelineCode: 0,
    });
    // Both lots still finished: the loser's other result is a member.
    expect(first).toMatchObject({ kind: 'recorded' });
    expect(second).toMatchObject({ kind: 'recorded' });
    expect(world.loads.map((l) => l.processed)).toEqual([2, 2]);
  });

  it('two lots of one timeline inserting the same code at the same moment: the timeline key refuses the second as ALREADY_IN_THIS_TIMELINE', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 1, timelineId: 11 }),
      loadRow({ id: 2, timelineId: 11 }),
    );
    world.loads[1]!.runningKey = null;
    const { uow } = inMemory(world);

    const results = await Promise.all([
      uow.recordLot(lotCommand(1, [5120])),
      uow.recordLot(lotCommand(2, [5120])),
    ]);

    expect(world.results).toHaveLength(1);
    const skips = results.flatMap((r) =>
      r.kind === 'recorded' ? r.raceSkips : [],
    );
    expect(skips).toEqual([
      { resultCode: 5120, reason: 'ALREADY_IN_THIS_TIMELINE' },
    ]);
    expect(world.violations).toEqual({
      runningKey: 0,
      activeKey: 0,
      timelineCode: 1,
    });
  });

  it('a lot that fails half way leaves no membership, no progress and no heartbeat behind', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 1, timelineId: 11, heartbeatAt: ago(MINUTE) }),
    );
    const transactions = new InMemoryLoadsTransactions(world);
    // The store refuses the second INSERT with an error that is not a duplicate.
    let inserts = 0;
    const flaky: LoadsTransactions = {
      run: (work) =>
        transactions.run((repositories) =>
          work({
            ...repositories,
            loads: Object.assign(
              Object.create(repositories.loads) as LoadsStore,
              {
                insertMembership: (values: NewMembershipValues) => {
                  if (++inserts === 2) throw new Error('the store failed');
                  return repositories.loads.insertMembership(values);
                },
              },
            ),
          }),
        ),
    };
    const before = structuredClone(world.loads);

    await expect(
      new LoadsUnitOfWork(flaky).recordLot(lotCommand(1, [5120, 5121, 5122])),
    ).rejects.toThrow('the store failed');

    expect(world.results).toEqual([]);
    expect(world.loads).toEqual(before);
    expect([transactions.committed, transactions.rolledBack]).toEqual([0, 1]);
  });

  it('a lot of a load that a later start abandoned writes nothing: the run learns it must stop', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(6 * MINUTE) }),
    );
    const { uow } = inMemory(world);
    await uow.start(startCommand());
    const after = structuredClone(world.loads);
    const history = [...world.history];

    const result = await uow.recordLot(lotCommand(5, [5120]));

    expect(result).toEqual({ kind: 'load_not_running', status: 'failed' });
    expect(world.results).toEqual([]);
    expect(world.loads).toEqual(after);
    expect(world.history).toEqual(history);
    expect(await uow.recordLot(lotCommand(99, [5120]))).toEqual({
      kind: 'load_not_found',
    });
  });

  it('a lot that renews the heartbeat in time makes a concurrent start see a live lease, so the start is refused and the load is not abandoned (FR-9)', async () => {
    const world = seedWorld();
    // The lease expired by the last heartbeat, but the run is alive and its lot is in flight.
    world.loads.push(
      loadRow({ id: 1, timelineId: 11, heartbeatAt: ago(6 * MINUTE) }),
    );
    const { uow } = inMemory(world);
    const codes = [5120, 5121, 5122, 5123, 5124, 5125, 5126, 5127];

    const [lot, start] = await Promise.all([
      uow.recordLot(lotCommand(1, codes)),
      uow.start(startCommand({ timelineId: 12 })),
    ]);

    expect(lot).toMatchObject({ kind: 'recorded', processed: 8 });
    expect(start).toEqual({ kind: 'already_running' });
    expect(world.loads).toHaveLength(1);
    expect(world.loads[0]).toMatchObject({
      status: 'running',
      heartbeatAt: NOW,
      processed: 8,
    });
    expect(auditOf(world, 'load_end')).toEqual([]);
  });
});

describe('ending expired memberships and the later timeline (FR-4, DD-5)', () => {
  it('ends only the active memberships of other timelines whose last step closed: the rule is membershipEnds, the closing minute is still open', async () => {
    const world = seedWorld();
    // Timeline 13: last step closed yesterday. 14: closed one minute ago. 15: closes this very minute.
    addTimeline(world.admin, {
      id: 14,
      name: 'T14',
      lastCloses: '2026-11-10T08:59',
    });
    addTimeline(world.admin, {
      id: 15,
      name: 'T15',
      lastCloses: '2026-11-10T09:00',
    });
    world.admin.steps.find((s) => s.id === 133)!.closesAt =
      minute('2026-11-09T17:30');
    world.results.push(
      memberRow({ id: 1, timelineId: 13, resultCode: 5120 }),
      memberRow({ id: 2, timelineId: 14, resultCode: 5121 }),
      memberRow({ id: 3, timelineId: 15, resultCode: 5122 }),
      // Already ended by a release: untouched.
      memberRow({
        id: 4,
        timelineId: 13,
        resultCode: 5123,
        endedAt: ago(60 * MINUTE),
        endReason: 'released_qaed',
      }),
      // Not closed at all.
      memberRow({ id: 5, timelineId: 12, resultCode: 5124 }),
    );
    const { uow, transactions } = inMemory(world);
    const memberships = await world.store.findMemberships(
      1,
      [5120, 5121, 5122, 5123, 5124],
    );

    const result = await uow.endExpired({
      timelineId: 11,
      memberships,
      now: NOW,
    });

    expect(result).toEqual({ ended: 2 });
    expect(
      world.results.map((r) => [
        r.id,
        r.endedAt?.toISOString() ?? null,
        r.endReason,
        r.activeKey,
      ]),
    ).toEqual([
      [1, NOW.toISOString(), 'timeline_closed', null],
      [2, NOW.toISOString(), 'timeline_closed', null],
      [3, null, null, '1#5122'],
      [4, ago(60 * MINUTE).toISOString(), 'released_qaed', null],
      [5, null, null, '1#5124'],
    ]);
    expect(transactions.begun).toBe(1);
  });

  it('never ends a membership of the timeline that is loading, and opens no transaction when nothing ends', async () => {
    const world = seedWorld();
    world.admin.steps.find((s) => s.id === 113)!.closesAt =
      minute('2026-11-09T17:30');
    world.results.push(
      memberRow({ id: 1, timelineId: 11, resultCode: 5120, loadId: 1 }),
    );
    const { uow, transactions } = inMemory(world);
    const memberships = await world.store.findMemberships(1, [5120]);

    expect(
      await uow.endExpired({ timelineId: 11, memberships, now: NOW }),
    ).toEqual({
      ended: 0,
    });
    expect(transactions.begun).toBe(0);
    expect(world.results[0]!.endedAt).toBeNull();
  });

  it("a later timeline after U closed: the end comes first, then the result becomes an active member of the loading timeline with U's row kept as ended", async () => {
    const world = seedWorld();
    world.admin.steps.find((s) => s.id === 123)!.closesAt =
      minute('2026-11-09T17:30');
    world.loads.push(
      loadRow({ id: 1, timelineId: 11 }),
      loadRow({ id: 2, timelineId: 12, status: 'completed' }),
    );
    world.results.push(
      memberRow({ id: 1, timelineId: 12, resultCode: 5120, loadId: 2 }),
    );
    const { uow } = inMemory(world);

    // Without the end the database refuses the result: that is why the order matters.
    const blocked = await uow.recordLot(lotCommand(1, [5120]));
    expect(blocked).toMatchObject({
      raceSkips: [{ resultCode: 5120, reason: 'ACTIVE_IN_OTHER_TIMELINE' }],
    });
    expect(world.results).toHaveLength(1);

    const memberships = await world.store.findMemberships(1, [5120]);
    await uow.endExpired({ timelineId: 11, memberships, now: NOW });
    const taken = await uow.recordLot(lotCommand(1, [5120]));

    expect(taken).toMatchObject({ insertedCodes: [5120], raceSkips: [] });
    expect(
      world.results.map((r) => [r.timelineId, r.endReason, r.activeKey]),
    ).toEqual([
      [12, 'timeline_closed', null],
      [11, null, '1#5120'],
    ]);
  });

  it('after the end the same timeline cannot take the result back (FR-4, S-5)', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 1, timelineId: 11 }));
    world.results.push(
      memberRow({
        id: 1,
        timelineId: 11,
        resultCode: 5120,
        endedAt: ago(MINUTE),
        endReason: 'timeline_closed',
      }),
    );
    const { uow } = inMemory(world);

    const result = await uow.recordLot(lotCommand(1, [5120]));

    expect(result).toMatchObject({
      raceSkips: [{ resultCode: 5120, reason: 'ALREADY_IN_THIS_TIMELINE' }],
    });
    expect(world.results).toHaveLength(1);
  });

  it('a result active in another cycle never blocks this one', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 1, timelineId: 11 }));
    world.results.push(
      memberRow({ id: 1, cycleId: 2, timelineId: 21, resultCode: 5120 }),
    );
    const { uow } = inMemory(world);

    const result = await uow.recordLot(lotCommand(1, [5120]));

    expect(result).toMatchObject({ insertedCodes: [5120], raceSkips: [] });
    expect(world.results.map((r) => [r.cycleId, r.activeKey])).toEqual([
      [2, '2#5120'],
      [1, '1#5120'],
    ]);
  });
});

describe('the end of a load over the in-memory world (FR-12)', () => {
  const running = () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({
        id: 1,
        timelineId: 11,
        total: 120,
        processed: 120,
        summary: {
          loaded: 100,
          byProgram: {},
          byType: {},
          kpGroups: {},
          skipped: {
            ACTIVE_IN_OTHER_TIMELINE: 15,
            ALREADY_IN_THIS_TIMELINE: 5,
          },
          otherTimelines: {},
        },
      }),
    );
    return inMemory(world);
  };

  it('completed: status, finished_at, the key freed, and one load_end row with the counts and a null reason', async () => {
    const { world, uow } = running();

    const result = await uow.end({ loadId: 1, status: 'completed', now: NOW });

    expect(result).toEqual({ kind: 'ended' });
    expect(world.loads[0]).toMatchObject({
      status: 'completed',
      runningKey: null,
      failureReason: null,
      finishedAt: NOW,
    });
    expect(world.admin.auditEvents).toEqual([
      {
        id: 1,
        timelineId: 11,
        actorId: 9,
        action: 'load_end',
        changes: {
          load: {
            before: 'running',
            after: {
              id: 1,
              status: 'completed',
              total: 120,
              processed: 120,
              loaded: 100,
              skipped: 20,
              failureReason: null,
            },
          },
        },
        requestId: 'req-0',
        createdAt: NOW,
      },
    ]);
  });

  it('failed: the reason is stored and in the load_end row, and what the lots recorded stays (FR-8)', async () => {
    const { world, uow } = running();
    world.results.push(
      memberRow({ id: 1, timelineId: 11, resultCode: 5120, loadId: 1 }),
    );

    const result = await uow.end({
      loadId: 1,
      status: 'failed',
      failureReason: 'REPORTING_UNAUTHORIZED',
      now: NOW,
    });

    expect(result).toEqual({ kind: 'ended' });
    expect(world.loads[0]).toMatchObject({
      status: 'failed',
      failureReason: 'REPORTING_UNAUTHORIZED',
      processed: 120,
      finishedAt: NOW,
    });
    expect(world.results).toHaveLength(1);
    expect(
      (world.admin.auditEvents[0]!.changes as TimelineAuditEvent['changes'])
        .load,
    ).toEqual({
      before: 'running',
      after: {
        id: 1,
        status: 'failed',
        total: 120,
        processed: 120,
        loaded: 100,
        skipped: 20,
        failureReason: 'REPORTING_UNAUTHORIZED',
      },
    });
  });

  it('load_end names its load: changes.load.after.id is the id of the load that ended, for a normal end and for the abandon of a stale one (FR-12, design 5.3)', async () => {
    const normal = running();
    const abandon = seedWorld();
    abandon.loads.push(
      loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(6 * MINUTE) }),
    );

    await normal.uow.end({ loadId: 1, status: 'completed', now: NOW });
    await inMemory(abandon).uow.start(startCommand());

    expect(auditOf(normal.world, 'load_end')[0]!.changes).toMatchObject({
      load: { after: { id: 1 } },
    });
    expect(auditOf(abandon, 'load_end')[0]!.changes).toMatchObject({
      load: { after: { id: 5 } },
    });
  });

  it('a second end changes nothing and writes no second load_end row', async () => {
    const { world, uow } = running();
    await uow.end({ loadId: 1, status: 'completed', now: NOW });
    const after = structuredClone(world.loads);

    const again = await uow.end({
      loadId: 1,
      status: 'failed',
      failureReason: 'INTERNAL',
      now: new Date(NOW.getTime() + MINUTE),
    });

    expect(again).toEqual({ kind: 'load_not_running', status: 'completed' });
    expect(world.loads).toEqual(after);
    expect(auditOf(world, 'load_end')).toHaveLength(1);
    expect(
      await uow.end({ loadId: 99, status: 'completed', now: NOW }),
    ).toEqual({
      kind: 'load_not_found',
    });
  });

  it('a run that ends after a start abandoned its load cannot turn it back: the load has the one load_end row of the abandon', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 12, heartbeatAt: ago(6 * MINUTE) }),
    );
    const { uow } = inMemory(world);
    await uow.start(startCommand());

    const result = await uow.end({ loadId: 5, status: 'completed', now: NOW });

    expect(result).toEqual({ kind: 'load_not_running', status: 'failed' });
    expect(world.loads.find((l) => l.id === 5)).toMatchObject({
      status: 'failed',
      failureReason: 'ABANDONED',
    });
    expect(
      auditOf(world, 'load_end').filter((e) => e.timelineId === 12),
    ).toHaveLength(1);
  });

  it('ending frees the cycle: the next start is accepted', async () => {
    const { world, uow } = running();
    await uow.end({ loadId: 1, status: 'completed', now: NOW });

    const next = await uow.start(startCommand({ timelineId: 12 }));

    expect(next).toMatchObject({ kind: 'started', loadId: 2 });
    expect(world.loads.filter((l) => l.status === 'running')).toHaveLength(1);
  });
});

describe('LoadsStore reads over the in-memory world', () => {
  it('the memberships of codes carry the timeline name and the last step, the loads list is newest first with who started each', async () => {
    const world = seedWorld();
    world.admin.base.users.push({
      id: 9,
      nickname: 'ana',
    } as (typeof world.admin.base.users)[number]);
    world.loads.push(
      loadRow({ id: 1, timelineId: 11, status: 'completed' }),
      loadRow({ id: 2, timelineId: 11 }),
      loadRow({ id: 3, timelineId: 12, status: 'completed' }),
    );
    world.results.push(memberRow({ id: 1, timelineId: 12, resultCode: 5120 }));

    expect(await world.store.findMemberships(1, [5120, 5999])).toEqual([
      {
        id: 1,
        resultCode: 5120,
        timelineId: 12,
        timelineName: 'August 2026',
        endedAt: null,
        lastStepClosesAt: '2026-12-18T17:30',
      },
    ]);
    expect(
      (await world.store.listByTimeline(11)).map((r) => [
        r.load.id,
        r.startedBy,
      ]),
    ).toEqual([
      [2, { id: 9, nickname: 'ana' }],
      [1, { id: 9, nickname: 'ana' }],
    ]);
    expect(await world.store.findLoad(11, 3)).toBeUndefined();
    expect((await world.store.findLoad(12, 3))?.load.id).toBe(3);
  });
});
