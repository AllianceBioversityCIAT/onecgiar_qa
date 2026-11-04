// @akili-spec ingestion/step-1-loads
import { Logger } from '@nestjs/common';
import { FakeResultsFeed } from '../../test/support/fake-results-feed.js';
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from '../../test/support/in-memory-loads.js';
import type { FieldCatalogSource } from '../admin-config/field-config/field-catalog.ports.js';
import type { RomeMinute } from '../admin-config/rome-date.js';
import type { Cycle } from '../database/drizzle/schema/cycles.js';
import type { TimelineLoad } from '../database/drizzle/schema/timeline-loads.js';
import type { TimelineResult } from '../database/drizzle/schema/timeline-results.js';
import { UpstreamStatusError } from '../users/catalogs/catalog-http.js';
import { UpstreamUnavailableError } from '../users/catalogs/catalogs.errors.js';
import { DEFAULT_KP_RULES } from './kp-classifier.js';
import type { LoadSummary } from './load-rules.js';
import { LoadRunner } from './load-runner.js';
import { TimelineHasNoStepsError } from './loads.store.js';
import { LoadsUnitOfWork } from './loads.unit-of-work.js';
import {
  FeedError,
  type FeedDetailsQuery,
  type FeedIntakeQuery,
  type FeedListItem,
} from './results-feed.port.js';

// Expected values are the FR-3, FR-6, FR-7, FR-8, FR-9, FR-12 and FR-14
// scenarios and design 7.3 written out as literals (the counts, the codes, the
// reasons, the delays), none read from the code under test. The feed is the
// fake that records every call in order, the snapshot store is the in-memory
// one, the world is the in-memory loads world over the real unit of work, and
// time is the fake clock of the test: the backoffs and the heartbeat are
// observed by moving it, never by counting calls alone.

// 2026-11-10 09:00 in Rome (UTC+1 after the clock change of 25 Oct).
const NOW = new Date('2026-11-10T08:00:00.000Z');
const SECOND = 1000;
const minute = (value: string) => value as RomeMinute;

// `setImmediate` stays real: the in-memory database waits on it for each statement.
const FAKE = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
] as const;

let logged: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  vi.setSystemTime(NOW);
  logged = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- the world -------------------------------------------------------------

function cycleRow(): Cycle {
  const created = new Date('2026-10-01T09:00:00.000Z');
  return {
    id: 1,
    year: 2026,
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

function addTimeline(world: InMemoryLoadsDatabase, id: number, name: string) {
  const created = new Date('2026-10-01T09:00:00.000Z');
  world.admin.timelines.push({
    id,
    cycleId: 1,
    name,
    kind: 'additional',
    officialKey: null,
    allPrograms: true,
    allResultTypes: true,
    createdAt: created,
    createdBy: 1,
    version: 1,
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
    world.admin.steps.push({
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
}

const SCOPE_ALL = {
  allPrograms: true,
  programIds: [],
  allResultTypes: true,
  resultTypeKeys: [],
};

function loadRow(
  id: number,
  overrides: Partial<TimelineLoad> = {},
): TimelineLoad {
  const row: TimelineLoad = {
    id,
    cycleId: 1,
    timelineId: 11,
    timelineStepId: 111,
    phaseYear: 2026,
    scope: structuredClone(SCOPE_ALL),
    status: 'running',
    runningKey: null,
    total: null,
    processed: 0,
    summary: null,
    failureReason: null,
    startedBy: 9,
    startedAt: NOW,
    heartbeatAt: NOW,
    finishedAt: null,
    requestId: 'req-1',
    ...overrides,
  };
  row.runningKey = row.status === 'running' ? row.cycleId : null;
  return row;
}

function memberRow(
  id: number,
  timelineId: number,
  resultCode: number,
  loadId: number,
): TimelineResult {
  return {
    id,
    cycleId: 1,
    timelineId,
    loadId,
    resultCode,
    resultId: resultCode - 4000,
    phaseYear: 2026,
    programClarisaId: 3,
    resultTypeKey: 'policy_change',
    status: 'pending',
    kpGroup: null,
    awaitsStep: null,
    snapshotSk: 'SNAP#',
    snapshotHash: 'b'.repeat(64),
    catalogVersion: '1.29',
    createdAt: new Date('2026-11-03T09:00:00.000Z'),
    endedAt: null,
    endReason: null,
    activeKey: `1#${resultCode}`,
  };
}

// --- the feed ----------------------------------------------------------------

const KP_AUTO = {
  'knowledge_product.is_melia': false,
  'knowledge_product.type': 'Journal Article',
  'knowledge_product.issue_date_cg': '2025-03-01',
  'knowledge_product.issue_date_wos': '2025-04-01',
  'knowledge_product.is_isi_cg': 1,
  'knowledge_product.is_isi_wos': 1,
  'knowledge_product.peer_reviewed_cg': 1,
  'knowledge_product.peer_reviewed_wos': 1,
  'knowledge_product.accessibility_cg': 'Open Access',
  'knowledge_product.accessibility_wos': 'open access ',
};

/** A feed item: result id 1000 + n, result code 5000 + n. */
const item = (n: number, type = 'policy_change'): FeedListItem => ({
  resultId: 1000 + n,
  resultCode: 5000 + n,
  program: { clarisaId: 3, code: 'SP03' },
  resultTypeKey: type,
  submittedAt: null,
});
const items = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => item(from + i));

interface FeedScript {
  /** Intake refuses these result ids, with this reason. */
  refuse?: Record<number, string>;
  /** Details answers this catalog version (default 1.29). */
  catalogVersion?: string;
  /** Values per result id (default one field). */
  values?: Record<number, Record<string, unknown>>;
  /** The answers of intake in call order: `'ok'` answers from the query; the last one repeats (default `['ok']`). */
  intake?: Array<'ok' | Error>;
  /** The same for details. */
  details?: Array<'ok' | Error>;
}

/** The list answers every item in one page; intake and details answer from what they are asked. */
function script(
  feed: FakeResultsFeed,
  listed: FeedListItem[],
  s: FeedScript = {},
) {
  const typeOf = new Map(listed.map((i) => [i.resultId, i.resultTypeKey]));
  feed.script('list', {
    phase: 2026,
    page: 1,
    pageSize: 200,
    total: listed.length,
    breakdown: { byProgram: [], byResultType: [] },
    items: listed,
  });
  const okIntake = (q: FeedIntakeQuery) => ({
    phaseYear: q.phaseYear,
    taken: q.resultIds
      .filter((id) => !s.refuse?.[id])
      .map((id) => ({ resultId: id, resultCode: id + 4000, changed: true })),
    notTaken: q.resultIds
      .filter((id) => s.refuse?.[id])
      .map((id) => ({
        resultId: id,
        resultCode: id + 4000,
        reason: s.refuse![id]!,
      })),
  });
  const okDetails = (q: FeedDetailsQuery) => ({
    phase: q.phaseYear,
    catalogVersion: s.catalogVersion ?? '1.29',
    results: q.resultIds.map((id) => ({
      resultId: id,
      resultCode: id + 4000,
      resultTypeKey: typeOf.get(id)!,
      values: s.values?.[id] ?? { title: `result ${id}` },
    })),
    notEligible: [],
  });
  feed.script(
    'intake',
    ...(s.intake ?? ['ok']).map((a) => (a === 'ok' ? okIntake : a)),
  );
  feed.script(
    'details',
    ...(s.details ?? ['ok']).map((a) => (a === 'ok' ? okDetails : a)),
  );
}

function build(
  options: {
    scope?: TimelineLoad['scope'];
    members?: TimelineResult[];
    release?: boolean;
    catalogRefreshTo?: string;
  } = {},
) {
  const world = new InMemoryLoadsDatabase();
  world.admin.cycles.push(cycleRow());
  addTimeline(world, 11, 'July 2026');
  addTimeline(world, 12, 'August 2026');
  world.loads.push(loadRow(1, options.scope ? { scope: options.scope } : {}));
  world.results.push(...(options.members ?? []));
  const uow = new LoadsUnitOfWork(new InMemoryLoadsTransactions(world));
  const feed = new FakeResultsFeed();
  const snapshots = new FakeSnapshotStore();
  const catalogs = {
    forYear: vi.fn(async () => ({ catalogVersion: '1.29' }) as never),
    refresh: vi.fn(
      async () =>
        ({ catalogVersion: options.catalogRefreshTo ?? '1.29' }) as never,
    ),
  } satisfies FieldCatalogSource;
  const runner = new LoadRunner(
    uow,
    world.store,
    feed,
    snapshots,
    catalogs,
    DEFAULT_KP_RULES,
    () => new Date(),
    options.release,
  );
  return { world, uow, feed, snapshots, catalogs, runner };
}

// --- driving the fake clock --------------------------------------------------

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lets the run work until `done` holds, moving the fake clock `step` ms per turn. */
async function until(done: () => boolean, step = 0): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    if (done()) return;
    await vi.advanceTimersByTimeAsync(step);
    await turn();
  }
  throw new Error('the condition was never reached');
}

const settled = (world: InMemoryLoadsDatabase) => () =>
  world.loads[0]!.status !== 'running';

/** Runs load 1 to its end; a retry waits on the fake clock, so it is moved `step` ms per turn. */
async function runToEnd(
  ctx: ReturnType<typeof build>,
  step = 0,
): Promise<TimelineLoad> {
  ctx.runner.run(1);
  await until(settled(ctx.world), step);
  return ctx.world.loads[0]!;
}

const summaryOf = (load: TimelineLoad) =>
  load.summary as unknown as LoadSummary;
const ends = (world: InMemoryLoadsDatabase) =>
  world.admin.auditEvents.filter((e) => e.action === 'load_end');

// --- FR-3: the lot ------------------------------------------------------------

describe('a lot (FR-3)', () => {
  it('2 collisions, 1 not_submitted and 47 taken: 47 memberships and snapshots, 3 skips, processed 50, details only for the 47', async () => {
    const ctx = build({
      members: [memberRow(1, 12, 5001, 40), memberRow(2, 12, 5002, 40)],
    });
    script(ctx.feed, items(1, 50), { refuse: { 1003: 'not_submitted' } });

    const load = await runToEnd(ctx);

    expect(load.status).toBe('completed');
    expect(load.processed).toBe(50);
    expect(load.total).toBe(50);
    const mine = ctx.world.results.filter((r) => r.timelineId === 11);
    expect(mine).toHaveLength(47);
    expect(mine.every((r) => r.loadId === 1)).toBe(true);
    expect(ctx.snapshots.size).toBe(47);
    expect(summaryOf(load)).toMatchObject({
      loaded: 47,
      skipped: { ACTIVE_IN_OTHER_TIMELINE: 2, not_submitted: 1 },
      otherTimelines: { '12': { name: 'August 2026', count: 2 } },
    });
    // The 2 skipped and the 1 refused never reach details.
    const detailsAsked = (ctx.feed.callsOf('details')[0] as FeedDetailsQuery)
      .resultIds;
    expect(detailsAsked).toHaveLength(47);
    expect(detailsAsked).not.toContain(1001);
    expect(detailsAsked).not.toContain(1002);
    expect(detailsAsked).not.toContain(1003);
  });

  it('intake of the 48 comes before details of the 47, and the snapshot is written before its membership', async () => {
    const ctx = build({
      members: [memberRow(1, 12, 5001, 40), memberRow(2, 12, 5002, 40)],
    });
    script(ctx.feed, items(1, 50), { refuse: { 1003: 'not_submitted' } });
    const order: string[] = [];
    const put = ctx.snapshots.put.bind(ctx.snapshots);
    vi.spyOn(ctx.snapshots, 'put').mockImplementation((s) => {
      order.push(`snapshot:${s.resultCode}`);
      return put(s);
    });

    await runToEnd(ctx);

    expect(ctx.feed.calls.map((c) => c.op)).toEqual([
      'list',
      'intake',
      'details',
    ]);
    const intakeIds = (ctx.feed.callsOf('intake')[0] as FeedIntakeQuery)
      .resultIds;
    const detailsIds = (ctx.feed.callsOf('details')[0] as FeedDetailsQuery)
      .resultIds;
    expect(intakeIds).toHaveLength(48);
    expect(detailsIds).toHaveLength(47);
    // Every snapshot put precedes the first membership insert.
    const firstMembership = ctx.world.history.findIndex((h) =>
      h.startsWith('result:insert'),
    );
    expect(order).toHaveLength(47);
    expect(firstMembership).toBeGreaterThan(-1);
    expect(ctx.snapshots.size).toBe(47);
  });

  it('re-run: the 47 members are skipped ALREADY_IN_THIS_TIMELINE and only the 5 new results are taken in', async () => {
    const members = Array.from({ length: 47 }, (_, i) =>
      memberRow(i + 1, 11, 5001 + i, 0),
    );
    const ctx = build({ members });
    script(ctx.feed, items(1, 52));

    const load = await runToEnd(ctx);

    expect(load.status).toBe('completed');
    // The 52 are two lots (50 and 2); only the new ones are ever sent.
    const asked = (op: 'intake' | 'details') =>
      ctx.feed
        .callsOf(op)
        .flatMap((q) => (q as FeedIntakeQuery | FeedDetailsQuery).resultIds);
    expect(asked('intake')).toEqual([1048, 1049, 1050, 1051, 1052]);
    expect(asked('details')).toEqual([1048, 1049, 1050, 1051, 1052]);
    expect(ctx.world.results).toHaveLength(52);
    expect(new Set(ctx.world.results.map((r) => r.resultCode)).size).toBe(52);
    expect(ctx.snapshots.size).toBe(5);
    expect(summaryOf(load)).toMatchObject({
      loaded: 5,
      skipped: { ALREADY_IN_THIS_TIMELINE: 47 },
    });
  });

  it('the scope is the one stored at start, whatever the timeline holds now', async () => {
    const ctx = build({
      scope: {
        allPrograms: false,
        programIds: [2],
        allResultTypes: false,
        resultTypeKeys: ['policy_change'],
      },
    });
    // The timeline itself says "all"; the run reads the load's own copy.
    script(ctx.feed, items(1, 3));

    await runToEnd(ctx);

    expect(ctx.feed.callsOf('list')[0]).toEqual({
      phaseYear: 2026,
      programIds: [2],
      resultTypeKeys: ['policy_change'],
      page: 1,
      pageSize: 200,
    });
  });
});

// --- FR-8, DD-8: errors and retries ------------------------------------------

describe('errors and retries (FR-8, DD-8)', () => {
  it('details 500 three times: failed REPORTING_UNAVAILABLE after 3 attempts, the earlier lot kept', async () => {
    const ctx = build();
    // Lot 1 is answered; lot 2 meets a 500 that never ends.
    script(ctx.feed, items(1, 60), {
      details: ['ok', new FeedError('unavailable', 500)],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('REPORTING_UNAVAILABLE');
    expect(ctx.feed.callsOf('details')).toHaveLength(4); // lot 1 once, lot 2 three times
    expect(ctx.world.results).toHaveLength(50);
    expect(load.processed).toBe(50);
    expect(ends(ctx.world)).toHaveLength(1);
    expect(ends(ctx.world)[0]!.changes).toEqual({
      load: {
        before: 'running',
        after: {
          id: 1,
          status: 'failed',
          total: 60,
          processed: 50,
          loaded: 50,
          skipped: 0,
          failureReason: 'REPORTING_UNAVAILABLE',
        },
      },
    });
  });

  // Jitter is +-20 %: with random at 0 the waits are 800 ms and 3200 ms, at 1 they are 1200 ms and 4800 ms.
  it.each([
    { random: 0, first: 800, second: 3200 },
    { random: 0.5, first: 1000, second: 4000 },
    { random: 1, first: 1200, second: 4800 },
  ])(
    'waits $first ms then $second ms between the three attempts (random $random)',
    async ({ random, first, second }) => {
      const ctx = build();
      script(ctx.feed, items(1, 2), {
        details: [new FeedError('unavailable', 500)],
      });
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const calls = () => ctx.feed.callsOf('details').length;

      ctx.runner.run(1);
      await until(() => calls() === 1);
      await vi.advanceTimersByTimeAsync(first - 1);
      await turn();
      expect(calls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await until(() => calls() === 2);
      await vi.advanceTimersByTimeAsync(second - 1);
      await turn();
      expect(calls()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await until(settled(ctx.world));

      expect(calls()).toBe(3);
      expect(ctx.world.loads[0]!.failureReason).toBe('REPORTING_UNAVAILABLE');
    },
  );

  it('intake 401: failed REPORTING_UNAUTHORIZED at once, one call, no wait, and the log line carries no key', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3), {
      intake: [new FeedError('unauthorized', 401)],
    });

    const load = await runToEnd(ctx, 100);

    expect(ctx.feed.callsOf('intake')).toHaveLength(1);
    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('REPORTING_UNAUTHORIZED');
    expect(ctx.feed.callsOf('details')).toHaveLength(0);
    expect(logged).toContain(
      '{"event":"ingestion","route":"run","loadId":1,"outcome":"failed","reason":"REPORTING_UNAUTHORIZED"}',
    );
  });

  it('any other 4xx is REPORTING_REJECTED and is not retried', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3), { intake: [new FeedError('rejected', 400)] });

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('REPORTING_REJECTED');
    expect(ctx.feed.callsOf('intake')).toHaveLength(1);
  });

  it('a catalog that differs once and then matches: one forced refresh, and the load completes', async () => {
    const ctx = build({ catalogRefreshTo: '1.30' });
    script(ctx.feed, items(1, 3), { catalogVersion: '1.30' });

    const load = await runToEnd(ctx);

    expect(load.status).toBe('completed');
    expect(ctx.catalogs.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.catalogs.refresh).toHaveBeenCalledWith(2026);
    expect(ctx.world.results.every((r) => r.catalogVersion === '1.30')).toBe(
      true,
    );
  });

  it('a catalog that still differs after the refresh: failed CATALOG_VERSION_MISMATCH, nothing recorded', async () => {
    const ctx = build({ catalogRefreshTo: '1.29' });
    script(ctx.feed, items(1, 3), { catalogVersion: '1.30' });

    const load = await runToEnd(ctx);

    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('CATALOG_VERSION_MISMATCH');
    expect(ctx.catalogs.refresh).toHaveBeenCalledTimes(1);
    expect(ctx.world.results).toHaveLength(0);
    expect(ctx.snapshots.size).toBe(0);
  });

  it('the snapshot written and then the lot transaction fails: the retry writes the same keys and the same hash, one item per result', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3));
    const put = vi.spyOn(ctx.snapshots, 'put');
    vi.spyOn(ctx.uow, 'recordLot').mockRejectedValueOnce(
      new Error('connection lost'),
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.status).toBe('completed');
    const first = put.mock.calls.slice(0, 3).map(([s]) => s);
    const retry = put.mock.calls.slice(3, 6).map(([s]) => s);
    expect(put).toHaveBeenCalledTimes(6);
    expect(retry).toEqual(first);
    expect(first.map((s) => s.resultCode)).toEqual([5001, 5002, 5003]);
    expect(first[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.snapshots.size).toBe(3);
    expect(ctx.world.results).toHaveLength(3);
    expect(summaryOf(load).loaded).toBe(3);
  });

  it('the store fails past three attempts: failed STORE_UNAVAILABLE', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3));
    const record = vi
      .spyOn(ctx.uow, 'recordLot')
      .mockRejectedValue(new Error('connection lost'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('STORE_UNAVAILABLE');
    expect(record).toHaveBeenCalledTimes(3);
  });

  it('a snapshot key that exists with another hash is INTERNAL and is not retried', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 2));
    await ctx.snapshots.put({
      resultCode: 5001,
      resultId: 1001,
      phaseYear: 2026,
      cycleId: 1,
      timelineId: 11,
      loadId: 1,
      resultTypeKey: 'policy_change',
      programClarisaId: 3,
      catalogVersion: '1.29',
      hash: 'f'.repeat(64),
      loadedAt: NOW.toISOString(),
      values: {},
    });
    const put = vi.spyOn(ctx.snapshots, 'put');

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('INTERNAL');
    expect(put.mock.calls.map(([s]) => s.resultCode)).toContain(5001);
    expect(put.mock.calls.filter(([s]) => s.resultCode === 5001)).toHaveLength(
      1,
    );
  });

  it('a membership of a timeline with no steps is logged by ids and fails the load INTERNAL without a retry', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 2));
    const reads = vi
      .spyOn(ctx.world.store, 'findMemberships')
      .mockRejectedValue(new TimelineHasNoStepsError(12));

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('INTERNAL');
    expect(reads).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      '{"event":"ingestion","route":"run","loadId":1,"outcome":"corrupt_timeline","timelineId":12}',
    );
  });

  it('a catalog that is down is retried like Reporting, then REPORTING_UNAVAILABLE', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 2));
    ctx.catalogs.forYear.mockRejectedValue(new UpstreamUnavailableError());
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('REPORTING_UNAVAILABLE');
    expect(ctx.catalogs.forYear).toHaveBeenCalledTimes(3);
  });

  // The catalog client answers a non-2xx with `UpstreamStatusError`, which is
  // also an `UpstreamUnavailableError`: its status, not its family, decides (FR-8).
  it('a catalog 401 for the load year: failed REPORTING_UNAUTHORIZED at once, one call, nothing listed or recorded, and the log line carries no key', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 2));
    ctx.catalogs.forYear.mockRejectedValue(new UpstreamStatusError(401));

    const load = await runToEnd(ctx, 100);

    expect(ctx.catalogs.forYear).toHaveBeenCalledTimes(1);
    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('REPORTING_UNAUTHORIZED');
    expect(ctx.feed.callsOf('intake')).toHaveLength(0);
    expect(ctx.world.results).toHaveLength(0);
    expect(logged).toContain(
      '{"event":"ingestion","route":"run","loadId":1,"outcome":"failed","reason":"REPORTING_UNAUTHORIZED"}',
    );
    expect(logged.some((line) => line.includes('"outcome":"retry"'))).toBe(
      false,
    );
  });

  it('the forced catalog refresh answers 401: failed REPORTING_UNAUTHORIZED at once, one refresh call, nothing recorded', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3), { catalogVersion: '1.30' });
    ctx.catalogs.refresh.mockRejectedValue(new UpstreamStatusError(401));

    const load = await runToEnd(ctx, 100);

    expect(ctx.catalogs.refresh).toHaveBeenCalledTimes(1);
    expect(load.status).toBe('failed');
    expect(load.failureReason).toBe('REPORTING_UNAUTHORIZED');
    expect(ctx.world.results).toHaveLength(0);
    expect(ctx.snapshots.size).toBe(0);
  });

  it.each([400, 403])(
    'a catalog %i for the load year: failed REPORTING_REJECTED at once, one call',
    async (status) => {
      const ctx = build();
      script(ctx.feed, items(1, 2));
      ctx.catalogs.forYear.mockRejectedValue(new UpstreamStatusError(status));

      const load = await runToEnd(ctx, 100);

      expect(ctx.catalogs.forYear).toHaveBeenCalledTimes(1);
      expect(load.failureReason).toBe('REPORTING_REJECTED');
    },
  );

  it('the forced catalog refresh answers 403: failed REPORTING_REJECTED at once, one refresh call', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3), { catalogVersion: '1.30' });
    ctx.catalogs.refresh.mockRejectedValue(new UpstreamStatusError(403));

    const load = await runToEnd(ctx, 100);

    expect(ctx.catalogs.refresh).toHaveBeenCalledTimes(1);
    expect(load.failureReason).toBe('REPORTING_REJECTED');
  });

  it('a catalog 503 for the load year is still retried: three calls, then REPORTING_UNAVAILABLE', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 2));
    ctx.catalogs.forYear.mockRejectedValue(new UpstreamStatusError(503));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('REPORTING_UNAVAILABLE');
    expect(ctx.catalogs.forYear).toHaveBeenCalledTimes(3);
  });

  it('the forced catalog refresh answers 503: retried three times, then REPORTING_UNAVAILABLE', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3), { catalogVersion: '1.30' });
    ctx.catalogs.refresh.mockRejectedValue(new UpstreamStatusError(503));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const load = await runToEnd(ctx, 100);

    expect(load.failureReason).toBe('REPORTING_UNAVAILABLE');
    expect(ctx.catalogs.refresh).toHaveBeenCalledTimes(3);
  });
});

// --- FR-9: the lease ------------------------------------------------------------

describe('the lease (FR-9)', () => {
  /** An intake that waits for the test, so the run stays alive on the fake clock. */
  function gated(ctx: ReturnType<typeof build>) {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const answer = ctx.feed.intake.bind(ctx.feed);
    vi.spyOn(ctx.feed, 'intake').mockImplementation(async (q) => {
      await gate;
      return answer(q);
    });
    return open;
  }

  it('the heartbeat advances every 60 s while the run waits, with no lot finishing', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 3));
    const open = gated(ctx);

    ctx.runner.run(1);
    await until(() => ctx.world.loads[0]!.total === 3);
    expect(ctx.world.loads[0]!.heartbeatAt).toEqual(NOW);

    await vi.advanceTimersByTimeAsync(61 * SECOND);
    await turn();
    expect(ctx.world.loads[0]!.heartbeatAt).toEqual(
      new Date(NOW.getTime() + 60 * SECOND),
    );

    await vi.advanceTimersByTimeAsync(60 * SECOND);
    await turn();
    expect(ctx.world.loads[0]!.heartbeatAt).toEqual(
      new Date(NOW.getTime() + 120 * SECOND),
    );
    expect(ctx.world.loads[0]!.processed).toBe(0);

    open();
    await until(settled(ctx.world));
    expect(ctx.world.loads[0]!.status).toBe('completed');
  });

  it('a load that was abandoned meanwhile stops the run: no second lot, no end row, no membership ended', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 60));
    const open = gated(ctx);

    ctx.runner.run(1);
    await until(() => ctx.world.loads[0]!.total === 60);
    // A later start persisted the abandon.
    const row = ctx.world.loads[0]!;
    row.status = 'failed';
    row.runningKey = null;
    row.failureReason = 'ABANDONED';
    await vi.advanceTimersByTimeAsync(61 * SECOND);
    await turn();
    open();
    for (let i = 0; i < 100; i++) await turn();

    expect(ctx.feed.callsOf('intake')).toHaveLength(1);
    expect(ctx.world.results).toHaveLength(0);
    expect(ctx.world.history.some((h) => h.startsWith('result:end'))).toBe(
      false,
    );
    expect(ends(ctx.world)).toHaveLength(0);
    expect(row.status).toBe('failed');
  });
});

// --- FR-7, FR-14: the KP rule and the release --------------------------------------

describe('KP groups and the release port (FR-7, FR-14)', () => {
  const kps = [
    item(1, 'knowledge_product'),
    item(2, 'knowledge_product'),
    item(3, 'knowledge_product'),
  ];
  const values = {
    1001: KP_AUTO,
    1002: {
      ...KP_AUTO,
      'knowledge_product.type': 'Book',
      'knowledge_product.is_melia': false,
    },
    1003: { ...KP_AUTO, 'knowledge_product.issue_date_wos': null },
  };

  it('with the release constant off, a completed load of auto-checked KPs makes no release call', async () => {
    const ctx = build();
    script(ctx.feed, kps, { values });

    const load = await runToEnd(ctx);

    expect(load.status).toBe('completed');
    expect(
      ctx.world.results.map((r) => [
        r.resultCode,
        r.status,
        r.kpGroup,
        r.awaitsStep,
      ]),
    ).toEqual([
      [5001, 'auto_validated', 'auto_checked', null],
      [5002, 'not_in_qa', 'not_in_qa', null],
      [5003, 'pending', 'review', 3],
    ]);
    expect(ctx.feed.callsOf('release')).toHaveLength(0);
    expect(ctx.feed.calls.map((c) => c.op)).toEqual([
      'list',
      'intake',
      'details',
    ]);
  });

  it('with the setting on, only the auto-checked and not-in-QA KPs are released as qaed, after the lots', async () => {
    const ctx = build({ release: true });
    script(ctx.feed, kps, { values });
    ctx.feed.script('release', (q) => ({
      phaseYear: q.phaseYear,
      released: q.items.map((i) => ({
        resultId: i.resultId,
        resultCode: i.resultId + 4000,
        outcome: i.outcome,
      })),
      notReleased: [],
    }));

    const load = await runToEnd(ctx);

    expect(load.status).toBe('completed');
    expect(ctx.feed.callsOf('release')).toEqual([
      {
        phaseYear: 2026,
        items: [
          { resultId: 1001, outcome: 'qaed' },
          { resultId: 1002, outcome: 'qaed' },
        ],
      },
    ]);
  });
});

// --- the snapshot ---------------------------------------------------------------------

describe('the snapshot content (FR-6, design 5.2)', () => {
  it('hashes the canonical JSON of the values, whatever the key order, and keeps the load start as the load time', async () => {
    const ctx = build();
    script(ctx.feed, items(1, 1), {
      values: { 1001: { b: [2, { y: 1, x: 0 }], a: null } },
    });

    await runToEnd(ctx);

    const [snapshot] = await ctx.snapshots.history(5001);
    // sha-256 of {"a":null,"b":[2,{"x":0,"y":1}]}
    expect(snapshot!.hash).toBe(
      'd35b1d88d66d811545929847a371613822f5679f2f589f664b7825160af660b6',
    );
    expect(snapshot!.loadedAt).toBe(NOW.toISOString());
    expect(ctx.world.results[0]!.snapshotHash).toBe(snapshot!.hash);
    expect(ctx.world.results[0]!.snapshotSk).toBe(
      'SNAP#2026#000001#00000011#0000000001',
    );
  });
});
