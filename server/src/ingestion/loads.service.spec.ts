// @akili-spec ingestion/step-1-loads
import { Logger } from '@nestjs/common';
import { FakeResultsFeed } from '../../test/support/fake-results-feed.js';
import { InMemoryAdminConfigDatabase } from '../../test/support/in-memory-admin-config.js';
import { FakeClock } from '../../test/support/in-memory-idempotency.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from '../../test/support/in-memory-loads.js';
import {
  CycleClosedError,
  TimelineNotFoundError,
} from '../admin-config/admin-config.errors.js';
import type { AdminConfigContext } from '../admin-config/admin-config.context.js';
import type { RomeMinute } from '../admin-config/rome-date.js';
import type { Cycle } from '../database/drizzle/schema/cycles.js';
import type { TimelineLoad } from '../database/drizzle/schema/timeline-loads.js';
import type { TimelineResult } from '../database/drizzle/schema/timeline-results.js';
import { UpstreamUnavailableError } from '../users/catalogs/catalogs.errors.js';
import { DEFAULT_KP_RULES } from './kp-classifier.js';
import {
  LoadAlreadyRunningError,
  LoadCatalogMissingError,
  LoadNotFoundError,
  LoadWindowClosedError,
} from './loads.errors.js';
import { LoadsService } from './loads.service.js';
import { LoadsUnitOfWork } from './loads.unit-of-work.js';
import {
  FeedError,
  type FeedDetailsQuery,
  type FeedListItem,
  type FeedListQuery,
  type FeedPage,
} from './results-feed.port.js';

// Expected values are the FR-1, FR-2, FR-9 and FR-10 scenarios and design
// 6 / 7.1 / 7.2 written out as literals (the 2025 KP rule, the counts, the
// codes, the statuses), none read from the code under test. The feed is the
// fake that records every call, the world is the in-memory loads world over the
// real unit of work, and the clock is fixed, so the preview, the start and the
// order of the runner are observed and not assumed.

// 2026-11-10 09:00 in Rome (UTC+1 after the clock change of 25 Oct).
const NOW = new Date('2026-11-10T08:00:00.000Z');
const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const minute = (value: string) => value as RomeMinute;

const ctx: AdminConfigContext = { actorId: 9, requestId: 'req-1' };

const SCOPE = {
  allPrograms: false,
  programIds: [2, 3],
  allResultTypes: false,
  resultTypeKeys: ['knowledge_product', 'policy_change'],
};

// The decision lines are checked in their own tests; elsewhere they are silenced.
beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

// --- the world -------------------------------------------------------------

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
  step1Closes?: string;
  lastCloses?: string;
  all?: boolean;
}

/** A timeline of three steps; scope SP02 + SP03 and KP + policy change, or "all" when `all` is set. */
function addTimeline(
  admin: InMemoryAdminConfigDatabase,
  seed: TimelineSeed,
): void {
  const created = new Date('2026-10-01T09:00:00.000Z');
  admin.timelines.push({
    id: seed.id,
    cycleId: seed.cycleId ?? 1,
    name: seed.name,
    kind: 'additional',
    officialKey: null,
    allPrograms: seed.all ?? false,
    allResultTypes: seed.all ?? false,
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
  if (seed.all) return;
  for (const programId of SCOPE.programIds) {
    admin.programs.push({ timelineId: seed.id, programId });
  }
  for (const resultTypeKey of SCOPE.resultTypeKeys) {
    admin.resultTypes.push({ timelineId: seed.id, resultTypeKey });
  }
}

/**
 * Cycle 1 (active, year 2026) with timelines 11 "July 2026" (version 4), 12
 * "August 2026" (U), 13 "September 2026" (its last step closed on 5 Nov) and
 * 14 "Everything" (scope all); cycle 3 (closed, year 2028) with timeline 31.
 */
function seedWorld() {
  const world = new InMemoryLoadsDatabase();
  world.admin.cycles.push(cycleRow(1), cycleRow(3, 'closed'));
  addTimeline(world.admin, { id: 11, name: 'July 2026', version: 4 });
  addTimeline(world.admin, { id: 12, name: 'August 2026' });
  addTimeline(world.admin, {
    id: 13,
    name: 'September 2026',
    lastCloses: '2026-11-05T17:30',
  });
  addTimeline(world.admin, { id: 14, name: 'Everything', all: true });
  addTimeline(world.admin, { id: 31, cycleId: 3, name: 'Old cycle' });
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
  row.runningKey = row.status === 'running' ? row.cycleId : null;
  return row;
}

function memberRow(timelineId: number, resultCode: number): TimelineResult {
  return {
    id: 0,
    cycleId: 1,
    timelineId,
    loadId: 40,
    resultCode,
    resultId: resultCode + 4000,
    phaseYear: 2026,
    programClarisaId: 3,
    resultTypeKey: 'policy_change',
    status: 'pending',
    kpGroup: null,
    awaitsStep: null,
    snapshotSk: 'SNAP#',
    snapshotHash: 'b'.repeat(64),
    catalogVersion: '1.29',
    createdAt: ago(60 * MINUTE),
    endedAt: null,
    endReason: null,
    activeKey: `1#${resultCode}`,
  };
}

function addMembers(
  world: InMemoryLoadsDatabase,
  timelineId: number,
  codes: number[],
): void {
  for (const code of codes) {
    world.results.push({
      ...memberRow(timelineId, code),
      id: world.nextResultId(),
    });
  }
}

// --- the feed --------------------------------------------------------------

/** Result n of the big listing: code 1000+n, id 5000+n; n < 150 are KPs, n < 300 are SP02. */
function feedItem(n: number): FeedListItem {
  return {
    resultId: 5000 + n,
    resultCode: 1000 + n,
    program:
      n < 300 ? { clarisaId: 2, code: 'SP02' } : { clarisaId: 3, code: 'SP03' },
    resultTypeKey: n < 150 ? 'knowledge_product' : 'policy_change',
    submittedAt: '2026-10-01T00:00:00.000Z',
  };
}

const emptyBreakdown = { byProgram: [], byResultType: [] };

/** A feed that lists `items` in pages of the size asked for (the page after the last is empty). */
function pagedList(items: FeedListItem[]) {
  return (q: FeedListQuery): FeedPage => {
    const size = q.pageSize ?? 200;
    const page = q.page ?? 1;
    return {
      phase: q.phaseYear,
      page,
      pageSize: size,
      total: items.length,
      breakdown: emptyBreakdown,
      items: items.slice((page - 1) * size, page * size),
    };
  };
}

/** KP details by the position of the result: n%3 = 0 auto-checked, 1 not in QA, 2 review (design 7.5). */
function kpDetails(q: FeedDetailsQuery) {
  return {
    phase: q.phaseYear,
    catalogVersion: '1.29',
    notEligible: [],
    results: q.resultIds.map((resultId) => {
      const n = resultId - 5000;
      const values: Record<string, unknown> =
        n % 3 === 0
          ? {
              'knowledge_product.type': 'Journal Article',
              'knowledge_product.is_melia': false,
              'knowledge_product.issue_date_cg': '2026-03-01',
              'knowledge_product.issue_date_wos': '2026-04-01',
              'knowledge_product.is_isi_cg': true,
              'knowledge_product.is_isi_wos': true,
              'knowledge_product.peer_reviewed_cg': true,
              'knowledge_product.peer_reviewed_wos': true,
              'knowledge_product.accessibility_cg': 'Open access',
              'knowledge_product.accessibility_wos': ' open access ',
            }
          : n % 3 === 1
            ? {
                'knowledge_product.type': 'Book',
                'knowledge_product.is_melia': false,
              }
            : {
                'knowledge_product.type': 'Book',
                'knowledge_product.is_melia': true,
              };
      return {
        resultId,
        resultCode: 1000 + n,
        resultTypeKey: 'knowledge_product',
        values,
      };
    }),
  };
}

const KP_RULE_KEYS = [
  'knowledge_product.is_melia',
  'knowledge_product.type',
  'knowledge_product.issue_date_cg',
  'knowledge_product.issue_date_wos',
  'knowledge_product.is_isi_cg',
  'knowledge_product.is_isi_wos',
  'knowledge_product.peer_reviewed_cg',
  'knowledge_product.peer_reviewed_wos',
  'knowledge_product.accessibility_cg',
  'knowledge_product.accessibility_wos',
];

// --- the service -----------------------------------------------------------

interface RunnerCall {
  loadId: number;
  /** Transactions committed when the runner was called. */
  committed: number;
  /** Whether the load row was already in the committed table. */
  rowVisible: boolean;
}

function build(
  options: {
    world?: InMemoryLoadsDatabase;
    feed?: FakeResultsFeed;
    now?: Date;
  } = {},
) {
  const world = options.world ?? seedWorld();
  const feed = options.feed ?? new FakeResultsFeed();
  const clock = new FakeClock(options.now ?? NOW);
  const transactions = new InMemoryLoadsTransactions(world);
  const runs: RunnerCall[] = [];
  const runner = {
    run: (loadId: number) =>
      void runs.push({
        loadId,
        committed: transactions.committed,
        rowVisible: world.loads.some((l) => l.id === loadId),
      }),
  };
  const service = new LoadsService(
    new LoadsUnitOfWork(transactions),
    world.store,
    world.admin.timelineStore,
    feed,
    DEFAULT_KP_RULES,
    runner,
    clock.now,
  );
  return { world, feed, transactions, runs, service, runner, clock };
}

/** Every write the world saw: loads, memberships, audit rows, timeline and cycle rows. */
const writesOf = (world: InMemoryLoadsDatabase) => [
  ...world.history,
  ...world.admin.history,
  ...world.admin.timelineWriteLog,
];

// --- preview ---------------------------------------------------------------

describe('LoadsService.preview (FR-1)', () => {
  it('reads all 3 pages and counts what is left after the skips, by program, type and KP group', async () => {
    // 420 results over 200 + 200 + 20; the last page holds the collisions:
    // codes 1400-1409 are active in U (12), 1410-1411 are already in T (11),
    // 1412 is in timeline 13 whose last step closed (it no longer blocks).
    const world = seedWorld();
    addMembers(
      world,
      12,
      [1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409],
    );
    addMembers(world, 11, [1410, 1411]);
    addMembers(world, 13, [1412]);
    const feed = new FakeResultsFeed()
      .script(
        'list',
        pagedList(Array.from({ length: 420 }, (_, n) => feedItem(n))),
      )
      .script('details', kpDetails);
    const { service } = build({ world, feed });

    const preview = await service.preview(ctx, 11);

    expect(preview).toEqual({
      phaseYear: 2026,
      window: 'open',
      toLoad: {
        total: 408,
        byProgram: [
          { programId: 2, code: 'SP02', count: 300 },
          { programId: 3, code: 'SP03', count: 108 },
        ],
        byResultType: [
          { key: 'knowledge_product', count: 150 },
          { key: 'policy_change', count: 258 },
        ],
      },
      kpGroups: { notInQa: 50, autoChecked: 50, review: 50 },
      skipped: [
        {
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          count: 10,
          timelines: [{ id: 12, name: 'August 2026', count: 10 }],
        },
        { reason: 'ALREADY_IN_THIS_TIMELINE', count: 2 },
      ],
    });

    // Every page, 200 at a time, with the scope of the timeline.
    expect(feed.callsOf('list')).toEqual([
      {
        phaseYear: 2026,
        programIds: [2, 3],
        resultTypeKeys: ['knowledge_product', 'policy_change'],
        page: 1,
        pageSize: 200,
      },
      {
        phaseYear: 2026,
        programIds: [2, 3],
        resultTypeKeys: ['knowledge_product', 'policy_change'],
        page: 2,
        pageSize: 200,
      },
      {
        phaseYear: 2026,
        programIds: [2, 3],
        resultTypeKeys: ['knowledge_product', 'policy_change'],
        page: 3,
        pageSize: 200,
      },
    ]);
    // The 150 KPs go to details in 3 lots of 50, with the 10 keys of the rule.
    const lots = feed.callsOf('details') as FeedDetailsQuery[];
    expect(lots.map((q) => q.resultIds.length)).toEqual([50, 50, 50]);
    expect(lots.every((q) => q.phaseYear === 2026)).toBe(true);
    expect(lots.every((q) => q.fieldKeys?.join() === KP_RULE_KEYS.join())).toBe(
      true,
    );
  });

  it('answers the scenario: 120 eligible results on 1 page, 10 active in U, 110 to load', async () => {
    const world = seedWorld();
    // Policy changes only: no KP, so no details call.
    const items = Array.from({ length: 120 }, (_, n) => ({
      ...feedItem(200 + n),
      resultTypeKey: 'policy_change',
    }));
    addMembers(
      world,
      12,
      items.slice(0, 10).map((item) => item.resultCode),
    );
    const feed = new FakeResultsFeed().script('list', pagedList(items));
    const { service } = build({ world, feed });

    const preview = await service.preview(ctx, 11);

    expect(preview.toLoad.total).toBe(110);
    expect(preview.skipped).toEqual([
      {
        reason: 'ACTIVE_IN_OTHER_TIMELINE',
        count: 10,
        timelines: [{ id: 12, name: 'August 2026', count: 10 }],
      },
    ]);
    expect(preview.kpGroups).toEqual({ notInQa: 0, autoChecked: 0, review: 0 });
    expect(feed.callsOf('list')).toHaveLength(1);
    expect(feed.callsOf('details')).toEqual([]);
  });

  it('writes nothing and calls neither intake nor release', async () => {
    const world = seedWorld();
    addMembers(world, 12, [1400]);
    const writesBefore = writesOf(world).length;
    const rowsBefore = [
      world.loads.length,
      world.results.length,
      world.admin.auditEvents.length,
    ];
    const feed = new FakeResultsFeed()
      .script(
        'list',
        pagedList(Array.from({ length: 420 }, (_, n) => feedItem(n))),
      )
      .script('details', kpDetails);
    const { service, transactions } = build({ world, feed });

    await service.preview(ctx, 11);

    expect(feed.callsOf('intake')).toEqual([]);
    expect(feed.callsOf('release')).toEqual([]);
    expect(feed.calls.every((c) => c.op === 'list' || c.op === 'details')).toBe(
      true,
    );
    expect(writesOf(world)).toHaveLength(writesBefore);
    expect([
      world.loads.length,
      world.results.length,
      world.admin.auditEvents.length,
    ]).toEqual(rowsBefore);
    expect(transactions.begun).toBe(0);
  });

  it('reads QA memberships with one call for all the codes (the store cuts the IN by 500)', async () => {
    const feed = new FakeResultsFeed()
      .script(
        'list',
        pagedList(Array.from({ length: 420 }, (_, n) => feedItem(n))),
      )
      .script('details', kpDetails);
    const { service, world } = build({ feed });

    await service.preview(ctx, 11);

    expect(world.store.membershipReads).toBe(1);
  });

  it('sends no program and no type filter when the timeline scope is all', async () => {
    const feed = new FakeResultsFeed().script(
      'list',
      pagedList([{ ...feedItem(200), resultTypeKey: 'policy_change' }]),
    );
    const { service } = build({ feed });

    await service.preview(ctx, 14);

    expect(feed.callsOf('list')).toStrictEqual([
      { phaseYear: 2026, page: 1, pageSize: 200 },
    ]);
  });

  it('answers 0 to load and no skips when the feed total is 0', async () => {
    const feed = new FakeResultsFeed().script('list', pagedList([]));
    const { service, world } = build({ feed });

    const preview = await service.preview(ctx, 11);

    expect(preview).toEqual({
      phaseYear: 2026,
      window: 'open',
      toLoad: { total: 0, byProgram: [], byResultType: [] },
      kpGroups: { notInQa: 0, autoChecked: 0, review: 0 },
      skipped: [],
    });
    expect(feed.callsOf('list')).toHaveLength(1);
    expect(world.store.membershipReads).toBe(0);
  });

  it('skips a code the feed lists twice (DUPLICATE_RESULT_CODE, both occurrences) and a KP that is not eligible', async () => {
    const policy = (n: number) => ({
      ...feedItem(200 + n),
      resultTypeKey: 'policy_change',
    });
    const kp = feedItem(0);
    const feed = new FakeResultsFeed()
      .script('list', pagedList([policy(1), policy(1), policy(2), kp]))
      .script('details', () => ({
        phase: 2026,
        catalogVersion: '1.29',
        results: [],
        notEligible: [{ resultId: kp.resultId, reason: 'NOT_SUBMITTED' }],
      }));
    const { service } = build({ feed });

    const preview = await service.preview(ctx, 11);

    expect(preview.toLoad.total).toBe(1);
    expect(preview.skipped).toEqual([
      { reason: 'DUPLICATE_RESULT_CODE', count: 2 },
      { reason: 'NOT_SUBMITTED', count: 1 },
    ]);
  });

  it('says the window is closed after step 1 closes, and when the cycle is closed', async () => {
    const afterClose = new Date('2026-11-20T16:31:00.000Z'); // 17:31 in Rome
    const lateFeed = new FakeResultsFeed().script('list', pagedList([]));
    const late = await build({
      feed: lateFeed,
      now: afterClose,
    }).service.preview(ctx, 11);
    const closedFeed = new FakeResultsFeed().script('list', pagedList([]));
    const closed = await build({ feed: closedFeed }).service.preview(ctx, 31);

    expect(late.window).toBe('closed');
    expect(closed.window).toBe('closed');
    expect(closed.phaseYear).toBe(2028);
  });

  it('answers 404 TIMELINES_NOT_FOUND without calling Reporting', async () => {
    const feed = new FakeResultsFeed();
    const { service } = build({ feed });

    await expect(service.preview(ctx, 999)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
    expect(feed.calls).toEqual([]);
  });

  it.each([
    ['401', new FeedError('unauthorized', 401)],
    ['5xx', new FeedError('unavailable', 503)],
    ['network', new FeedError('unavailable')],
  ])(
    'answers 503 SERVICE_UNAVAILABLE when the feed fails with %s',
    async (_name, failure) => {
      const feed = new FakeResultsFeed().script('list', failure);
      const { service } = build({ feed });

      await expect(service.preview(ctx, 11)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    },
  );

  it('answers 409 LOADS_CATALOG_MISSING when Reporting has no catalog for the year (404), and logs it as a refusal', async () => {
    const feed = new FakeResultsFeed().script(
      'list',
      new FeedError('rejected', 404),
    );
    const { service } = build({ feed });

    const refusal = (await service
      .preview(ctx, 11)
      .catch((e: unknown) => e)) as LoadCatalogMissingError;

    expect(refusal).toBeInstanceOf(LoadCatalogMissingError);
    expect(refusal.getStatus()).toBe(409);
    expect(refusal.getResponse()).toMatchObject({
      code: 'LOADS_CATALOG_MISSING',
    });
  });

  it("leaves any other 4xx a defect (not a 409, not a 503) and names Reporting's status in the log line", async () => {
    const feed = new FakeResultsFeed().script(
      'list',
      new FeedError('rejected', 400),
    );
    const { service } = build({ feed });
    const errors = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.preview(ctx, 11)).rejects.toBeInstanceOf(FeedError);
    const lines = errors.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((l) => l.includes('"reason":"reporting_rejected_400"')),
    ).toBe(true);
    errors.mockRestore();
  });

  it('answers 503 when a page comes back empty before total is reached (no endless loop)', async () => {
    const feed = new FakeResultsFeed().script('list', (q) => ({
      phase: q.phaseYear,
      page: q.page ?? 1,
      pageSize: 200,
      total: 5,
      breakdown: emptyBreakdown,
      items: [],
    }));
    const { service } = build({ feed });

    await expect(service.preview(ctx, 11)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(feed.callsOf('list')).toHaveLength(1);
  });
});

// --- start -----------------------------------------------------------------

/** A feed whose probe answers: Reporting is up. */
const upFeed = () => new FakeResultsFeed().script('list', pagedList([]));

describe('LoadsService.start (FR-2)', () => {
  it('answers the load id as running, bumps the version, and starts the runner once, after the commit', async () => {
    const feed = upFeed();
    const { service, world, runs } = build({ feed });

    const started = await service.start(ctx, 11);

    expect(started).toEqual({ id: 1, status: 'running' });
    expect(
      world.loads.map((l) => [l.id, l.timelineId, l.status, l.phaseYear]),
    ).toEqual([[1, 11, 'running', 2026]]);
    expect(world.admin.timelines.find((t) => t.id === 11)!.version).toBe(5);
    // Once, with the committed load: the order is the assertion.
    expect(runs).toEqual([{ loadId: 1, committed: 1, rowVisible: true }]);
  });

  it('probes Reporting with one list call of page size 1 before it writes anything', async () => {
    const feed = upFeed();
    const { service } = build({ feed });

    await service.start(ctx, 11);

    expect(feed.calls).toEqual([
      { op: 'list', query: { phaseYear: 2026, page: 1, pageSize: 1 } },
    ]);
  });

  /** A keyed request as the interceptor leaves it: the key reserved, its handle in the context (FR-2 Safe retry). */
  async function keyed(world: InMemoryLoadsDatabase) {
    const store = world.admin.base.idempotencyStore(new FakeClock().now);
    const reserved = await store.reserve({
      actorId: 9,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 202,
    });
    if (reserved.kind !== 'reserved') throw new Error('key already in use');
    const keyedCtx: AdminConfigContext = {
      ...ctx,
      idempotency: { reservation: reserved.reservation, outcome: 'none' },
    };
    return { store, keyedCtx };
  }

  it('carries the request key to the unit of work: the key is marked executed with the load id, in the same commit as the load row', async () => {
    const world = seedWorld();
    const { store, keyedCtx } = await keyed(world);
    const { service, transactions } = build({ world, feed: upFeed() });

    const started = await service.start(keyedCtx, 11);

    expect(started).toEqual({ id: 1, status: 'running' });
    expect(store.peek(9, 'key-1')).toMatchObject({
      state: 'executed',
      targetUserId: 1,
    });
    expect(world.loads.map((l) => l.id)).toEqual([1]);
    // One transaction wrote both: no second commit marked the key apart.
    expect([transactions.committed, transactions.rolledBack]).toEqual([1, 0]);
  });

  it('a second start with the same key ends with one load, and the key still points at the first', async () => {
    const world = seedWorld();
    const { store, keyedCtx } = await keyed(world);
    const { service, runs } = build({ world, feed: upFeed() });
    await service.start(keyedCtx, 11);

    await expect(service.start(keyedCtx, 11)).rejects.toBeInstanceOf(
      LoadAlreadyRunningError,
    );

    expect(world.loads.map((l) => l.id)).toEqual([1]);
    expect(store.peek(9, 'key-1')).toMatchObject({
      state: 'executed',
      targetUserId: 1,
    });
    expect(runs.map((r) => r.loadId)).toEqual([1]);
  });

  it('accepts the request at the closing minute and refuses one minute later with no row', async () => {
    const atClose = build({
      feed: upFeed(),
      now: new Date('2026-11-20T16:30:00.000Z'),
    }); // 17:30 Rome
    const late = build({
      feed: upFeed(),
      now: new Date('2026-11-20T16:31:00.000Z'),
    }); // 17:31 Rome

    await expect(atClose.service.start(ctx, 11)).resolves.toEqual({
      id: 1,
      status: 'running',
    });
    await expect(late.service.start(ctx, 11)).rejects.toBeInstanceOf(
      LoadWindowClosedError,
    );
    expect(late.world.loads).toEqual([]);
    expect(late.runs).toEqual([]);
  });

  it.each([
    [
      'an unknown timeline',
      999,
      () => {},
      TimelineNotFoundError,
      404,
      'TIMELINES_NOT_FOUND',
    ],
    ['a closed cycle', 31, () => {}, CycleClosedError, 409, 'CYCLES_CLOSED'],
    [
      'a running load of another timeline of the cycle',
      11,
      (world: InMemoryLoadsDatabase) =>
        world.loads.push(loadRow({ id: 70, timelineId: 12 })),
      LoadAlreadyRunningError,
      409,
      'LOADS_ALREADY_RUNNING',
    ],
  ])(
    'refuses %s, writing no row and not starting the runner',
    async (_name, timelineId, arrange, error, status, code) => {
      const world = seedWorld();
      arrange(world);
      const rowsBefore = structuredClone(world.loads);
      const { service, runs } = build({ world, feed: upFeed() });

      const refusal = await service
        .start(ctx, timelineId)
        .catch((e: unknown) => e);

      expect(refusal).toBeInstanceOf(error);
      expect((refusal as InstanceType<typeof error>).getStatus()).toBe(status);
      expect(
        (refusal as InstanceType<typeof error>).getResponse(),
      ).toMatchObject({ code });
      expect(world.loads).toEqual(rowsBefore);
      expect(writesOf(world)).toEqual([]);
      expect(runs).toEqual([]);
    },
  );

  it('answers the window refusal with 409 LOADS_WINDOW_CLOSED', async () => {
    const { service } = build({
      feed: upFeed(),
      now: new Date('2026-11-20T16:31:00.000Z'),
    });

    const refusal = (await service
      .start(ctx, 11)
      .catch((e: unknown) => e)) as LoadWindowClosedError;

    expect(refusal.getStatus()).toBe(409);
    expect(refusal.getResponse()).toMatchObject({
      code: 'LOADS_WINDOW_CLOSED',
    });
  });

  it('does not let a stale running load block: the start is accepted and the old load reads failed / ABANDONED', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 70, timelineId: 12, heartbeatAt: ago(6 * MINUTE) }),
    );
    const { service } = build({ world, feed: upFeed() });

    const started = await service.start(ctx, 11);

    expect(started).toEqual({ id: 71, status: 'running' });
    const old = world.loads.find((l) => l.id === 70)!;
    expect([old.status, old.failureReason]).toEqual(['failed', 'ABANDONED']);
  });

  it.each([
    ['401', new FeedError('unauthorized', 401)],
    ['500', new FeedError('unavailable', 500)],
    ['a timeout', new FeedError('unavailable')],
  ])(
    'answers 503 SERVICE_UNAVAILABLE when the probe fails with %s, with no row and no transaction',
    async (_name, failure) => {
      const feed = new FakeResultsFeed().script('list', failure);
      const { service, world, runs, transactions } = build({ feed });

      const refusal = (await service
        .start(ctx, 11)
        .catch((e: unknown) => e)) as UpstreamUnavailableError;

      expect(refusal).toBeInstanceOf(UpstreamUnavailableError);
      expect(refusal.getStatus()).toBe(503);
      expect(refusal.getResponse()).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(world.loads).toEqual([]);
      expect(writesOf(world)).toEqual([]);
      expect(transactions.begun).toBe(0);
      expect(runs).toEqual([]);
    },
  );

  it('does not turn a 4xx the probe gets into a 503 (it is a defect, not an outage)', async () => {
    const feed = new FakeResultsFeed().script(
      'list',
      new FeedError('rejected', 400),
    );
    const { service, world } = build({ feed });

    await expect(service.start(ctx, 11)).rejects.toBeInstanceOf(FeedError);
    expect(world.loads).toEqual([]);
  });

  it('answers 409 LOADS_CATALOG_MISSING when the probe gets a 404 (no catalog for the year), with no row and no transaction', async () => {
    const feed = new FakeResultsFeed().script(
      'list',
      new FeedError('rejected', 404),
    );
    const { service, world, runs, transactions } = build({ feed });

    await expect(service.start(ctx, 11)).rejects.toBeInstanceOf(
      LoadCatalogMissingError,
    );
    expect(world.loads).toEqual([]);
    expect(transactions.begun).toBe(0);
    expect(runs).toEqual([]);
  });

  it('answers 409 LOADS_ALREADY_RUNNING when the start loses a deadlock (rolled back whole)', async () => {
    const { world, feed, runs, clock, runner } = build({ feed: upFeed() });
    const deadlocked = Object.assign(new Error('Deadlock found'), {
      errno: 1213,
    });
    const service = new LoadsService(
      {
        start: () =>
          Promise.reject(new Error('wrapped', { cause: deadlocked })),
      } as unknown as LoadsUnitOfWork,
      world.store,
      world.admin.timelineStore,
      feed,
      DEFAULT_KP_RULES,
      runner,
      clock.now,
    );

    await expect(service.start(ctx, 11)).rejects.toBeInstanceOf(
      LoadAlreadyRunningError,
    );
    expect(runs).toEqual([]);
  });

  it('still answers the recorded load when the runner cannot be started, and logs one error line', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const { world, feed, clock } = build({ feed: upFeed() });
    const service = new LoadsService(
      new LoadsUnitOfWork(new InMemoryLoadsTransactions(world)),
      world.store,
      world.admin.timelineStore,
      feed,
      DEFAULT_KP_RULES,
      {
        run: () => {
          throw new Error('boom');
        },
      },
      clock.now,
    );

    await expect(service.start(ctx, 11)).resolves.toEqual({
      id: 1,
      status: 'running',
    });
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        event: 'ingestion',
        route: 'start',
        timelineId: 11,
        outcome: 'runner_error',
        requestId: 'req-1',
      },
    ]);
  });

  it('logs one ingestion line per request with ids and fixed words only (design 7.8)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service } = build({
      feed: upFeed(),
      now: new Date('2026-11-20T16:31:00.000Z'),
    });

    await service.start(ctx, 11).catch(() => undefined);
    await service.list(ctx, 11);

    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        event: 'ingestion',
        route: 'start',
        timelineId: 11,
        outcome: 'refused',
        reason: 'LOADS_WINDOW_CLOSED',
        requestId: 'req-1',
      },
    ]);
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        event: 'ingestion',
        route: 'list',
        timelineId: 11,
        outcome: 'ok',
        requestId: 'req-1',
      },
    ]);
  });
});

// --- reads -----------------------------------------------------------------

describe('LoadsService.list and get (FR-10, FR-9)', () => {
  it('shows progress: running, processed 275 of 1200', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 11, total: 1200, processed: 275 }),
    );
    const { service } = build({ world });

    const [item] = await service.list(ctx, 11);

    expect(item).toMatchObject({
      id: 5,
      status: 'running',
      processed: 275,
      total: 1200,
      failureReason: null,
      finishedAt: null,
    });
  });

  it('lists the loads of the timeline only, newest first, with who started each', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({
        id: 3,
        timelineId: 11,
        status: 'completed',
        total: 4,
        processed: 4,
        startedAt: new Date('2026-11-09T10:00:00.000Z'),
        finishedAt: new Date('2026-11-09T10:05:00.000Z'),
      }),
      loadRow({ id: 4, timelineId: 12, status: 'completed' }),
      loadRow({
        id: 6,
        timelineId: 11,
        status: 'failed',
        failureReason: 'REPORTING_UNAVAILABLE',
        startedAt: new Date('2026-11-10T07:00:00.000Z'),
      }),
    );
    const { service } = build({ world });

    const items = await service.list(ctx, 11);

    expect(items.map((i) => [i.id, i.status, i.failureReason])).toEqual([
      [6, 'failed', 'REPORTING_UNAVAILABLE'],
      [3, 'completed', null],
    ]);
    expect(items[1]).toEqual({
      id: 3,
      status: 'completed',
      total: 4,
      processed: 4,
      startedAt: '2026-11-09T10:00:00.000Z',
      finishedAt: '2026-11-09T10:05:00.000Z',
      startedBy: { id: 9, nickname: null },
      failureReason: null,
    });
  });

  it('reads a running load whose heartbeat is 6 minutes old as failed / ABANDONED, in the list and in the detail', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 11, heartbeatAt: ago(6 * MINUTE) }),
    );
    const { service } = build({ world });

    const [item] = await service.list(ctx, 11);
    const detail = await service.get(ctx, 11, 5);

    expect([item!.status, item!.failureReason]).toEqual([
      'failed',
      'ABANDONED',
    ]);
    expect([detail.status, detail.failureReason]).toEqual([
      'failed',
      'ABANDONED',
    ]);
    // Reading does not write: the row stays as stored until the next start.
    expect(world.loads[0]!.status).toBe('running');
  });

  it('keeps a running load with a heartbeat of 4 minutes as running', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({ id: 5, timelineId: 11, heartbeatAt: ago(4 * MINUTE) }),
    );
    const { service } = build({ world });

    expect((await service.get(ctx, 11, 5)).status).toBe('running');
  });

  it('answers the detail with the summary: by program, type, KP group and skips with the other timelines named', async () => {
    const world = seedWorld();
    world.loads.push(
      loadRow({
        id: 5,
        timelineId: 11,
        status: 'completed',
        summary: {
          loaded: 7,
          byProgram: { '3': 2, '2': 5 },
          byType: { policy_change: 4, knowledge_product: 3 },
          kpGroups: { review: 1, auto_checked: 2 },
          skipped: { ALREADY_IN_THIS_TIMELINE: 1, ACTIVE_IN_OTHER_TIMELINE: 3 },
          otherTimelines: { '12': { name: 'August 2026', count: 3 } },
        },
      }),
    );
    const { service } = build({ world });

    const { summary } = await service.get(ctx, 11, 5);

    expect(summary).toEqual({
      loaded: 7,
      byProgram: [
        { programId: 2, count: 5 },
        { programId: 3, count: 2 },
      ],
      byResultType: [
        { key: 'knowledge_product', count: 3 },
        { key: 'policy_change', count: 4 },
      ],
      kpGroups: { notInQa: 0, autoChecked: 2, review: 1 },
      skipped: [
        {
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          count: 3,
          timelines: [{ id: 12, name: 'August 2026', count: 3 }],
        },
        { reason: 'ALREADY_IN_THIS_TIMELINE', count: 1 },
      ],
    });
  });

  it('answers an empty summary for a load that has not recorded a lot yet', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 5, timelineId: 11 }));
    const { service } = build({ world });

    expect((await service.get(ctx, 11, 5)).summary).toEqual({
      loaded: 0,
      byProgram: [],
      byResultType: [],
      kpGroups: { notInQa: 0, autoChecked: 0, review: 0 },
      skipped: [],
    });
  });

  it('answers 404 TIMELINES_NOT_FOUND for an unknown timeline and 404 LOADS_NOT_FOUND for a load of another one', async () => {
    const world = seedWorld();
    world.loads.push(loadRow({ id: 5, timelineId: 12, status: 'completed' }));
    const { service } = build({ world });

    await expect(service.list(ctx, 999)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
    await expect(service.get(ctx, 999, 5)).rejects.toBeInstanceOf(
      TimelineNotFoundError,
    );
    const refusal = (await service
      .get(ctx, 11, 5)
      .catch((e: unknown) => e)) as LoadNotFoundError;
    expect(refusal).toBeInstanceOf(LoadNotFoundError);
    expect(refusal.getStatus()).toBe(404);
    expect(refusal.getResponse()).toMatchObject({ code: 'LOADS_NOT_FOUND' });
    await expect(service.get(ctx, 11, 404)).rejects.toBeInstanceOf(
      LoadNotFoundError,
    );
  });
});
