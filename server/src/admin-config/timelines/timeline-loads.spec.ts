// @akili-spec ingestion/step-1-loads
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryAdminConfigDatabase } from '../../../test/support/in-memory-admin-config.js';
import { InMemoryTimelinesUnitOfWork } from '../../../test/support/in-memory-admin-config.js';
import { FakeClock } from '../../../test/support/in-memory-idempotency.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from '../../../test/support/in-memory-loads.js';
import { LoadsUnitOfWork } from '../../ingestion/loads.unit-of-work.js';
import * as schema from '../../database/drizzle/schema/index.js';
import type { Cycle } from '../../database/drizzle/schema/cycles.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import { TimelineVersionStaleError } from '../admin-config.errors.js';
import type { RomeMinute } from '../rome-date.js';
import { DrizzleTimelineLoads } from './timeline-loads.js';
import { TimelinesService } from './timelines.service.js';
import type { TimelinesUnitOfWork } from './timelines.unit-of-work.js';

// Expected values are design 7.6, S-6 and the FR-11 scenarios written out, with
// the literals of the schema (table and column names); none is read from the
// code under test. The SQL is asserted over a stub MySQL driver (there is no
// disposable MySQL: the shared qadb is never touched); the race runs the real
// `LoadsUnitOfWork.start` and the real `TimelinesService.update` over the
// in-memory world, whose unique keys and row locks are guarded in
// `loads.unit-of-work.spec.ts`.

// 2026-11-10 09:00 in Rome (UTC+1 after the clock change of 25 Oct).
const NOW = new Date('2026-11-10T08:00:00.000Z');
const minute = (value: string) => value as RomeMinute;

// --- the SQL of `withLoad` (design 7.6, S-6, FR-11, DD-6) -------------------

interface Statement {
  sql: string;
  params: unknown[];
}

/** `DrizzleTimelineLoads` over a stub driver: every statement lands in `log`, and `rows` is what the select finds (the ids). */
function adapter(rows: number[] = []) {
  const log: Statement[] = [];
  const pool = {
    query: ({ sql }: { sql: string }, values?: unknown[]) => {
      log.push({ sql, params: values ?? [] });
      return Promise.resolve([rows.map((id) => [id]), []]);
    },
  };
  const db = drizzle({ client: pool as never, schema, mode: 'default' });
  return { log, loads: new DrizzleTimelineLoads(db, () => NOW) };
}

describe('DrizzleTimelineLoads.withLoad: one statement (design 7.6)', () => {
  it('asks for the ids once, on the timelines table: a membership, a completed load, or a running load with an alive lease', async () => {
    const { log, loads } = adapter();

    await loads.withLoad([11, 12]);

    expect(log).toHaveLength(1);
    const { sql, params } = log[0]!;
    // The three ways to "have a load", in this order.
    expect(sql).toMatch(
      /^select `id` from `timelines` where \(`timelines`\.`id` in \(\?, \?\) and \(exists \(select 1 from `timeline_results` where `timeline_results`\.`timeline_id` = `timelines`\.`id`\) or exists \(select 1 from `timeline_loads` where \(`timeline_loads`\.`timeline_id` = `timelines`\.`id` and \(`timeline_loads`\.`status` = \? or \(`timeline_loads`\.`status` = \? and `timeline_loads`\.`heartbeat_at` >= \?\)\)\)\)\)\)$/,
    );
    expect(params.slice(0, 4)).toEqual([11, 12, 'completed', 'running']);
  });

  it('a completed load counts (also with zero members, S-6) and a failed one never does: the statuses asked for are completed and running only', async () => {
    const { log, loads } = adapter();

    await loads.withLoad([11]);

    const statuses = log[0]!.params.filter(
      (param) => typeof param === 'string' && /^[a-z_]+$/.test(param),
    );
    expect(statuses).toEqual(['completed', 'running']);
    expect(log[0]!.sql).not.toContain('failed');
    // No literal status in the text: the statuses are bound values, and the
    // only one with no other condition is `completed`.
    expect(log[0]!.sql).toMatch(
      /`timeline_loads`\.`status` = \? or \(`timeline_loads`\.`status` = \? and/,
    );
  });

  it('a running load counts only while its lease is alive: the heartbeat must be at or after now minus 5 minutes, so one at exactly 5 minutes is alive and an older one is out', async () => {
    const { log, loads } = adapter();

    await loads.withLoad([11]);

    // 08:00:00 UTC minus 5 minutes, as the datetime column encodes it.
    expect(log[0]!.params).toEqual([
      11,
      'completed',
      'running',
      '2026-11-10 07:55:00.000',
    ]);
    expect(log[0]!.sql).toMatch(/`timeline_loads`\.`heartbeat_at` >= \?/);
  });

  it('answers the ids the statement found, and nothing for the rest', async () => {
    const { loads } = adapter([12]);

    expect(await loads.withLoad([11, 12, 13])).toEqual(new Set([12]));
  });

  it('asks nothing for no timeline', async () => {
    const { log, loads } = adapter();

    expect(await loads.withLoad([])).toEqual(new Set());
    expect(log).toEqual([]);
  });
});

// --- the world of the race and of the count --------------------------------

function cycleRow(id: number): Cycle {
  const created = new Date('2026-10-01T09:00:00.000Z');
  return {
    id,
    year: 2025 + id,
    status: 'active',
    activeKey: 1,
    createdAt: created,
    createdBy: 1,
    activatedAt: created,
    activatedBy: 1,
    closedAt: null,
    closedBy: null,
  };
}

/** A timeline of three steps (ids `id * 10 + position`), program 2 and result type KP. */
function addTimeline(
  admin: InMemoryAdminConfigDatabase,
  id: number,
  version = 1,
): void {
  const created = new Date('2026-10-01T09:00:00.000Z');
  admin.timelines.push({
    id,
    cycleId: 1,
    name: `Timeline ${id}`,
    kind: 'additional',
    officialKey: null,
    allPrograms: false,
    allResultTypes: false,
    createdAt: created,
    createdBy: 1,
    version,
    updatedAt: null,
    updatedBy: null,
  });
  const audiences = ['assessors', 'programs', 'lead_assessors'] as const;
  const moments = [
    ['2026-11-02T09:00', '2026-11-20T17:30'],
    ['2026-11-23T09:00', '2026-12-04T17:30'],
    ['2026-12-07T09:00', '2026-12-18T17:30'],
  ] as const;
  moments.forEach(([opensAt, closesAt], index) => {
    admin.steps.push({
      id: id * 10 + index + 1,
      timelineId: id,
      position: index + 1,
      name: `Step ${index + 1}`,
      audience: audiences[index]!,
      opensAt: minute(opensAt),
      closesAt: minute(closesAt),
      round: 1,
      requiresLoad: index === 0,
    });
  });
  admin.programs.push({ timelineId: id, programId: 2 });
  admin.resultTypes.push({ timelineId: id, resultTypeKey: 'KP' });
}

const PROGRAMS = [
  { id: 1, code: 'SP01', name: 'Breeding' },
  { id: 2, code: 'SP02', name: 'Multifunctional landscapes' },
  { id: 3, code: 'SP03', name: 'Climate action' },
];
const RESULT_TYPES = [{ key: 'KP', name: 'Knowledge product' }];

/** The edit service over the same database and row locks as the load start; `beforeWrite` runs between the edit's reads and its transaction. */
function world(
  options: {
    timelines?: number[];
    beforeWrite?: () => Promise<void>;
  } = {},
) {
  const loadsWorld = new InMemoryLoadsDatabase();
  const admin = loadsWorld.admin;
  admin.cycles.push(cycleRow(1));
  for (const id of options.timelines ?? [11]) {
    addTimeline(admin, id, id === 11 ? 4 : 1);
  }
  const base = new InMemoryTimelinesUnitOfWork(admin);
  const unitOfWork: TimelinesUnitOfWork = {
    run: async (work) => {
      await options.beforeWrite?.();
      return base.run(work);
    },
  };
  const catalogs = new CatalogService(
    { list: vi.fn(async () => RESULT_TYPES) },
    { list: vi.fn(async () => PROGRAMS) },
    () => Date.now(),
  );
  const clock = new FakeClock(NOW);
  const service = new TimelinesService(
    unitOfWork,
    admin.timelineStore,
    catalogs,
    clock.now,
    admin.loads,
  );
  const starts = new LoadsUnitOfWork(new InMemoryLoadsTransactions(loadsWorld));
  const start = () =>
    starts.start({
      cycleId: 1,
      timelineId: 11,
      actorId: 9,
      requestId: 'req-load',
      now: NOW,
    });
  return { loadsWorld, admin, service, start };
}

const ctx = { actorId: 7, requestId: 'req-edit' };
const programsOf = (admin: InMemoryAdminConfigDatabase, timelineId: number) =>
  admin.programs
    .filter((p) => p.timelineId === timelineId)
    .map((p) => p.programId);

// --- the race (FR-11 "Load and edit race", DD-7, P-13) ----------------------

describe('a load start between the edit reads and the edit write (FR-11, DD-7)', () => {
  it('the edit read version 4 and found no load; the start commits (version 5); the edit write is TIMELINES_VERSION_STALE and the scope is the one the load read', async () => {
    let versionWhenTheStartRan: number | undefined;
    let loadsWhenTheStartRan: number | undefined;
    const w = world({
      beforeWrite: async () => {
        // Everything the edit reads is behind it here: the timeline at 4, no load.
        versionWhenTheStartRan = w.admin.timelines.find(
          (t) => t.id === 11,
        )!.version;
        loadsWhenTheStartRan = w.loadsWorld.loads.length;
        const started = await w.start();
        expect(started.kind).toBe('started');
      },
    });

    const edit = w.service.update(ctx, 11, { version: 4, programIds: [2, 3] });

    await expect(edit).rejects.toBeInstanceOf(TimelineVersionStaleError);
    await expect(edit).rejects.toMatchObject({
      response: { code: 'TIMELINES_VERSION_STALE' },
    });
    expect(versionWhenTheStartRan).toBe(4);
    expect(loadsWhenTheStartRan).toBe(0);
    // The load started with the scope it read; the edit changed nothing.
    expect(w.loadsWorld.loads).toHaveLength(1);
    expect(w.loadsWorld.loads[0]!.scope.programIds).toEqual([2]);
    expect(programsOf(w.admin, 11)).toEqual([2]);
    expect(w.admin.timelines.find((t) => t.id === 11)!.version).toBe(5);
    // No audit row of an edit: only the load's start.
    expect(w.admin.auditEvents.map((event) => event.action)).toEqual([
      'load_start',
    ]);
  });

  it('with no start in between the same edit commits: the stale answer above is the version bump and not the edit being refused for another reason', async () => {
    const w = world();

    const answer = await w.service.update(ctx, 11, {
      version: 4,
      programIds: [2, 3],
    });

    expect(answer.version).toBe(5);
    expect(programsOf(w.admin, 11)).toEqual([2, 3]);
  });
});

// --- the list count (NFR-5, design 7.6) -------------------------------------

describe('the timeline list with the real adapter (NFR-5)', () => {
  it('runs seven statements, 1 timeline or 50: the six of the list plus the one of withLoad', async () => {
    const counted = async (ids: number[]) => {
      const w = world({ timelines: ids });
      const { log, loads } = adapter();
      const service = new TimelinesService(
        new InMemoryTimelinesUnitOfWork(w.admin),
        w.admin.timelineStore,
        new CatalogService(
          { list: async () => RESULT_TYPES },
          { list: async () => PROGRAMS },
          () => Date.now(),
        ),
        () => NOW,
        loads,
      );
      w.admin.timelineReadLog.length = 0;
      const listed = await service.listByCycle(1);
      return {
        listed: listed.length,
        // The store's reads of the world, then the one statement on the stub driver.
        statements: w.admin.timelineReadLog.length + log.length,
        asked: log.map((s) => s.params.slice(0, s.params.length - 3)),
      };
    };

    const one = await counted([11]);
    const many = await counted(Array.from({ length: 50 }, (_, i) => 11 + i));

    expect(one.listed).toBe(1);
    expect(many.listed).toBe(50);
    expect(one.statements).toBe(7);
    expect(many.statements).toBe(7);
    // One batched call, with every id of the list.
    expect(many.asked).toHaveLength(1);
    expect(many.asked[0]).toHaveLength(50);
  });
});
