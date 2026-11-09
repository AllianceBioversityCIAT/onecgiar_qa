// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import request from 'supertest';
import type { RomeMinute } from '../src/admin-config/rome-date.js';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import { FeedError } from '../src/ingestion/results-feed.port.js';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import {
  ADMIN_NICKNAME,
  bearer,
  buildIngestionApp,
  closeAllStepsOfTimeline13,
  NOW,
  scriptFeed,
  type IngestionApp,
} from './support/ingestion-app.js';
import { LogSpy } from './support/log-spy.js';

// Step-1 loads over the real app (ingestion/step-1-loads T-9): FR-1 (preview),
// FR-2 (start, 202, one running load per cycle, safe retry), FR-10 (list and
// read), FR-13 (ADMIN only, and Reporting is not called for anyone else),
// NFR-3 (the start answers without awaiting the run). The guards, the pipe, the
// filter, the idempotency interceptor, the service, the unit of work and the
// runner are real; the stores, the clock and the Reporting feed are the
// in-memory world of `support/ingestion-app.ts` (today in Rome is 2026-11-10
// 09:00). Expected values are the spec's, written out. Timeline-sync T-7 adds
// the sync window judged on the LAST step (FR-1), the round and the step
// position (FR-10), the new preview and summary counts (FR-9), and a round-2
// sync that re-admits a result returned through the store (no HTTP route
// returns a result, FR-6).

const NON_ADMINS = [
  'ASSESSOR',
  'LEAD_ASSESSOR',
  'TPB',
  'PPU',
  'GUEST',
  'MULTI_GRANT',
] as const;

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

/** One minute of Rome time as the steps store it. */
const minute = (value: string) => value as RomeMinute;

/**
 * Re-shapes timeline `timelineId` into five steps around the fixed clock
 * (2026-11-10 09:00 Rome), rounds 1, 1, 2, 2, 2: steps 1-3 closed, step 4 open
 * since 08:00 today, step 5 the last one (closing on `lastCloses`).
 */
function useFiveSteps(
  w: IngestionApp,
  timelineId: number,
  lastCloses = '2026-11-27T17:30',
): void {
  const mine = w.world.steps
    .filter((step) => step.timelineId === timelineId)
    .sort((a, b) => a.position - b.position);
  const shape: Array<[string, string, number]> = [
    ['2026-10-26T09:00', '2026-11-02T17:30', 1],
    ['2026-11-03T09:00', '2026-11-06T17:30', 1],
    ['2026-11-07T09:00', '2026-11-09T17:30', 2],
    ['2026-11-10T08:00', '2026-11-13T17:30', 2],
    ['2026-11-16T09:00', lastCloses, 2],
  ];
  shape.forEach(([opensAt, closesAt, round], index) => {
    let step = mine[index];
    if (!step) {
      step = {
        ...mine[2]!,
        id: timelineId * 10 + index + 1,
        position: index + 1,
      };
      w.world.steps.push(step);
    }
    step.opensAt = minute(opensAt);
    step.closesAt = minute(closesAt);
    step.round = round;
  });
}

describe('Step-1 loads routes (e2e)', () => {
  let w: IngestionApp;
  const held: Array<() => void> = [];
  const spy = new LogSpy();

  beforeEach(async () => {
    w = await buildIngestionApp();
    spy.attach();
  });

  afterEach(async () => {
    // A run still blocked on the feed must end before the app closes.
    for (const release of held.splice(0)) release();
    try {
      await w.settled(11);
    } catch {
      // A test that never started a load has nothing to wait for.
    }
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  /** Blocks the runner's page reads (200 a page) until released; the start's one-result probe still answers. */
  const holdRunner = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = w.feed.list.bind(w.feed);
    w.feed.list = (query) =>
      query.pageSize === 1 ? original(query) : gate.then(() => original(query));
    held.push(release);
    return release;
  };

  /** Everything a request could write or read upstream, as one comparable value. */
  const nothingRan = () => ({
    feed: w.feed.calls.length,
    loads: w.loadsWorld.loads.length,
    members: w.loadsWorld.results.length,
    loadWrites: w.loadsWorld.history.length,
    adminWrites: w.world.history.length,
    timelineWrites: w.world.timelineWriteLog.length,
    audit: w.world.auditEvents.length,
    snapshots: w.snapshots.size,
    versions: w.world.timelines.map((t) => t.version),
  });

  const ROUTES: Array<['GET' | 'POST', string]> = [
    ['GET', '/timelines/11/loads/preview'],
    ['POST', '/timelines/11/loads'],
    ['GET', '/timelines/11/loads'],
    ['GET', '/timelines/11/loads/1'],
  ];
  const call = (
    [method, path]: ['GET' | 'POST', string],
    options: Parameters<IngestionApp['send']>[2] = {},
  ) => w.send(method === 'GET' ? 'get' : 'post', path, options);

  describe('FR-13: access', () => {
    it('has a 403 row for every grantable role (a new role without one fails here)', () => {
      const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
      for (const { code } of GRANTABLE_ROLES) {
        expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
      }
    });

    it.each(ROUTES)(
      '%s %s: 401 without a token and with one that is not valid, before anything else',
      async (...route) => {
        scriptFeed(w.feed, { total: 3 });
        const before = nothingRan();

        for (const token of [null, 'Bearer not-a-token']) {
          expectError(
            await call(route, { token, key: 'k-401' }),
            401,
            'AUTH_TOKEN_INVALID',
          );
        }

        expect(nothingRan()).toEqual(before);
      },
    );

    for (const role of NON_ADMINS) {
      it.each(ROUTES)(
        `%s %s: ${role} gets 403 AUTH_PERMISSION_DENIED, Reporting is not called and nothing is written`,
        async (...route) => {
          scriptFeed(w.feed, { total: 3 });
          const before = nothingRan();

          const res = await call(route, {
            token: bearer(`sub-${role.toLowerCase()}`),
            key: `k-${role}`,
          });

          expectError(res, 403, 'AUTH_PERMISSION_DENIED');
          expect(w.feed.calls).toEqual([]);
          expect(nothingRan()).toEqual(before);
        },
      );
    }

    it('an ADMIN gets through every route', async () => {
      scriptFeed(w.feed, { total: 3 });
      const preview = await w.send('get', '/timelines/11/loads/preview');
      holdRunner();
      const started = await w.send('post', '/timelines/11/loads');
      const list = await w.send('get', '/timelines/11/loads');
      const one = await w.send(
        'get',
        `/timelines/11/loads/${started.body.data.id}`,
      );

      expect([preview.status, started.status, list.status, one.status]).toEqual(
        [200, 202, 200, 200],
      );
    });
  });

  describe('FR-1: GET /timelines/:id/loads/preview', () => {
    it('answers what a load would do, from every page of the feed, and writes nothing', async () => {
      scriptFeed(w.feed, { total: 5, kps: 2 });
      const before = nothingRan();

      const res = await w.send('get', '/timelines/11/loads/preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
      expect(res.body.data).toEqual({
        phaseYear: 2026,
        window: 'open',
        round: 1,
        stepPosition: 1,
        toLoad: {
          total: 5,
          new: 5,
          resubmitted: 0,
          byProgram: [{ programId: 2, code: 'SP02', count: 5 }],
          byResultType: [
            { key: 'knowledge_product', count: 2 },
            { key: 'policy_change', count: 3 },
          ],
        },
        returnedNotResubmitted: { total: 0, byProgram: [], byResultType: [] },
        kpGroups: { notInQa: 2, autoChecked: 0, review: 0 },
        skipped: [],
      });
      // The scope of the timeline went to the feed: its year, programs and types.
      const [listed] = w.feed.callsOf('list') as Array<Record<string, unknown>>;
      expect(listed).toMatchObject({ phaseYear: 2026, page: 1, pageSize: 200 });
      expect(
        [...(listed!.programIds as number[])].sort((a, b) => a - b),
      ).toEqual([2, 3]);
      expect([...(listed!.resultTypeKeys as string[])].sort()).toEqual([
        'knowledge_product',
        'policy_change',
      ]);
      // No intake, no release, no row, no snapshot, no version bump.
      expect(w.feed.callsOf('intake')).toEqual([]);
      expect(w.feed.callsOf('release')).toEqual([]);
      expect({ ...nothingRan(), feed: before.feed }).toEqual(before);
    });

    it('counts a result another timeline holds as a skip and names that timeline', async () => {
      scriptFeed(w.feed, { total: 5 });
      w.loadsWorld.results.push({
        id: w.loadsWorld.nextResultId(),
        cycleId: 1,
        timelineId: 12,
        loadId: 40,
        resultCode: 1003,
        resultId: 5003,
        phaseYear: 2026,
        programClarisaId: 2,
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
        activeKey: '1#1003',
        entryRound: 1,
        previousMembershipId: null,
        changedFields: null,
      });

      const res = await w.send('get', '/timelines/11/loads/preview');

      expect(res.status).toBe(200);
      expect(res.body.data.toLoad.total).toBe(4);
      expect(res.body.data.skipped).toEqual([
        {
          reason: 'ACTIVE_IN_OTHER_TIMELINE',
          count: 1,
          timelines: [{ id: 12, name: 'August 2026', count: 1 }],
        },
      ]);
    });

    it('says the window is closed when the last step has closed, and when the cycle is closed', async () => {
      closeAllStepsOfTimeline13(w);
      scriptFeed(w.feed, { total: 1 });

      const stepClosed = await w.send('get', '/timelines/13/loads/preview');
      const cycleClosed = await w.send('get', '/timelines/31/loads/preview');

      expect(stepClosed.body.data.window).toBe('closed');
      expect(cycleClosed.body.data.window).toBe('closed');
    });

    it('says the window is open when only step 1 has closed: timeline 13 closed step 1 yesterday, step 2 opens on 23 Nov and the last step closes on 18 Dec', async () => {
      scriptFeed(w.feed, { total: 1 });

      const res = await w.send('get', '/timelines/13/loads/preview');

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        window: 'open',
        round: 1,
        stepPosition: 1,
      });
    });

    it('404 TIMELINES_NOT_FOUND for a timeline that does not exist, with Reporting not called', async () => {
      scriptFeed(w.feed, { total: 1 });

      const res = await w.send('get', '/timelines/999/loads/preview');

      expectError(res, 404, 'TIMELINES_NOT_FOUND');
      expect(w.feed.calls).toEqual([]);
    });

    it.each(['abc', '0', '-3', '1.5'])(
      '400 VALIDATION_FAILED on `id` for %s, before any lookup',
      async (id) => {
        const res = await w.send('get', `/timelines/${id}/loads/preview`);

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.fields[0].field).toBe('id');
        expect(w.feed.calls).toEqual([]);
      },
    );

    it.each([
      ['an outage', new FeedError('unavailable')],
      ['a 401', new FeedError('unauthorized', 401)],
    ])(
      '503 SERVICE_UNAVAILABLE when Reporting answers %s',
      async (_n, failure) => {
        w.feed.script('list', failure);

        const res = await w.send('get', '/timelines/11/loads/preview');

        expectError(res, 503, 'SERVICE_UNAVAILABLE');
      },
    );

    it('409 LOADS_CATALOG_MISSING when Reporting has no catalog for the cycle year (404)', async () => {
      w.feed.script('list', new FeedError('rejected', 404));

      const res = await w.send('get', '/timelines/11/loads/preview');

      expectError(res, 409, 'LOADS_CATALOG_MISSING');
    });
  });

  describe('FR-2: POST /timelines/:id/loads', () => {
    it('answers 202 with the load id while the run is still blocked on Reporting (NFR-3), and the run goes on after', async () => {
      scriptFeed(w.feed, { total: 5, kps: 2 });
      const release = holdRunner();
      const versionBefore = w.world.timelines.find((t) => t.id === 11)!.version;

      const startedAt = Date.now();
      const res = await w.send('post', '/timelines/11/loads');
      const elapsed = Date.now() - startedAt;

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        success: true,
        data: { id: 1, status: 'running' },
        meta: { requestId: res.headers['x-request-id'] },
      });
      expect(Object.keys(res.body.data).sort()).toEqual(['id', 'status']);
      expect(elapsed).toBeLessThan(2000);
      // The runner is still waiting on its first page: the answer did not wait for it.
      const running = await w.send('get', '/timelines/11/loads');
      expect(running.body.data).toMatchObject([
        { id: 1, status: 'running', processed: 0, finishedAt: null },
      ]);
      expect(w.feed.callsOf('intake')).toEqual([]);
      expect(w.loadsWorld.results).toHaveLength(0);
      // One load row, the version up by one, one `load_start` audit row.
      expect(w.loadsWorld.loads).toHaveLength(1);
      expect(w.world.timelines.find((t) => t.id === 11)!.version).toBe(
        versionBefore + 1,
      );
      expect(w.world.auditEvents.map((e) => e.action)).toEqual(['load_start']);

      release();
      const [done] = await w.settled(11);
      expect(done).toMatchObject({ id: 1, status: 'completed' });
      expect(w.loadsWorld.results).toHaveLength(5);
      expect(w.snapshots.size).toBe(5);
    });

    it('a repeat with the same Idempotency-Key returns the same load id and only one load exists (safe retry)', async () => {
      scriptFeed(w.feed, { total: 3 });
      holdRunner();

      const first = await w.send('post', '/timelines/11/loads', {
        key: 'retry-1',
      });
      const probesAfterFirst = w.feed.callsOf('list').length;
      const second = await w.send('post', '/timelines/11/loads', {
        key: 'retry-1',
      });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body.data).toEqual(first.body.data);
      expect(second.body.data.id).toBe(1);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(w.loadsWorld.loads).toHaveLength(1);
      // The replay ran nothing: no second probe, no second audit row.
      expect(w.feed.callsOf('list')).toHaveLength(probesAfterFirst);
      expect(
        w.world.auditEvents.filter((e) => e.action === 'load_start'),
      ).toHaveLength(1);
    });

    it('the same key with another timeline is 422 IDEMPOTENCY_KEY_REUSED', async () => {
      scriptFeed(w.feed, { total: 3 });
      holdRunner();
      await w.send('post', '/timelines/11/loads', { key: 'reuse-1' });

      const res = await w.send('post', '/timelines/12/loads', {
        key: 'reuse-1',
      });

      expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
      expect(w.loadsWorld.loads).toHaveLength(1);
    });

    it('a second start of the cycle is 409 LOADS_ALREADY_RUNNING, for the same timeline and for another one', async () => {
      scriptFeed(w.feed, { total: 3 });
      holdRunner();
      expect((await w.send('post', '/timelines/11/loads')).status).toBe(202);

      for (const timelineId of [11, 12]) {
        const res = await w.send('post', `/timelines/${timelineId}/loads`, {
          key: `second-${timelineId}`,
        });
        expectError(res, 409, 'LOADS_ALREADY_RUNNING');
      }

      expect(w.loadsWorld.loads).toHaveLength(1);
      expect(w.world.auditEvents).toHaveLength(1);
    });

    it('409 LOADS_WINDOW_CLOSED one minute after the last step closes, and no load row', async () => {
      closeAllStepsOfTimeline13(w);
      scriptFeed(w.feed, { total: 3 });
      const before = nothingRan();

      const res = await w.send('post', '/timelines/13/loads');

      expectError(res, 409, 'LOADS_WINDOW_CLOSED');
      expect({ ...nothingRan(), feed: before.feed }).toEqual(before);
    });

    it('409 CYCLES_CLOSED for a timeline of a closed cycle, and no load row', async () => {
      scriptFeed(w.feed, { total: 3 });

      const res = await w.send('post', '/timelines/31/loads');

      expectError(res, 409, 'CYCLES_CLOSED');
      expect(w.loadsWorld.loads).toHaveLength(0);
    });

    it('a replayed refusal answers the stored refusal and runs nothing', async () => {
      closeAllStepsOfTimeline13(w);
      scriptFeed(w.feed, { total: 3 });
      const first = await w.send('post', '/timelines/13/loads', {
        key: 'refused-1',
      });
      const calls = w.feed.calls.length;

      const replay = await w.send('post', '/timelines/13/loads', {
        key: 'refused-1',
      });

      expectError(first, 409, 'LOADS_WINDOW_CLOSED');
      expectError(replay, 409, 'LOADS_WINDOW_CLOSED');
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(w.feed.calls).toHaveLength(calls);
    });

    it('404 TIMELINES_NOT_FOUND, with Reporting not called and the key not spent', async () => {
      scriptFeed(w.feed, { total: 3 });

      const res = await w.send('post', '/timelines/999/loads', {
        key: 'ghost-1',
      });

      expectError(res, 404, 'TIMELINES_NOT_FOUND');
      expect(w.feed.calls).toEqual([]);
      expect(w.loadsWorld.loads).toHaveLength(0);
    });

    it.each([
      ['an outage', new FeedError('unavailable')],
      ['a 401', new FeedError('unauthorized', 401)],
    ])(
      '503 SERVICE_UNAVAILABLE when the Reporting check fails with %s: nothing is written and the key can be retried',
      async (_n, failure) => {
        scriptFeed(w.feed, { total: 2 });
        const answering = w.feed.list.bind(w.feed);
        w.feed.list = () => Promise.reject(failure);
        const before = nothingRan();

        const res = await w.send('post', '/timelines/11/loads', {
          key: 'down-1',
        });

        expectError(res, 503, 'SERVICE_UNAVAILABLE');
        expect({ ...nothingRan(), feed: before.feed }).toEqual(before);

        // Reporting is back: the same key starts the load (a 5xx is not remembered).
        w.feed.list = answering;
        holdRunner();
        const retry = await w.send('post', '/timelines/11/loads', {
          key: 'down-1',
        });
        expect(retry.status).toBe(202);
        expect(retry.headers['idempotency-replayed']).toBeUndefined();
      },
    );

    it('400 VALIDATION_FAILED for a body with a key (the body is `{}`), and for a malformed Idempotency-Key', async () => {
      scriptFeed(w.feed, { total: 3 });

      const withKey = await w.send('post', '/timelines/11/loads', {
        body: { timelineId: 12 },
      });
      const badKey = await w.send('post', '/timelines/11/loads', {
        key: 'not a valid key!',
      });

      expectError(withKey, 400, 'VALIDATION_FAILED');
      expect(withKey.body.error.fields[0].field).toBe('timelineId');
      expectError(badKey, 400, 'VALIDATION_FAILED');
      expect(badKey.body.error.fields[0].field).toBe('Idempotency-Key');
      expect(w.loadsWorld.loads).toHaveLength(0);
    });

    it('accepts the empty body `{}` as the design says', async () => {
      scriptFeed(w.feed, { total: 1 });
      holdRunner();

      const res = await w.send('post', '/timelines/11/loads', { body: {} });

      expect(res.status).toBe(202);
    });

    it('400 MALFORMED_JSON for a body that is not JSON', async () => {
      const res = await request(w.app.getHttpServer())
        .post('/api/v1/timelines/11/loads')
        .set('Authorization', bearer('sub-admin'))
        .set('Content-Type', 'application/json')
        .send('{not json');

      expectError(res, 400, 'MALFORMED_JSON');
      expect(w.loadsWorld.loads).toHaveLength(0);
    });
  });

  describe('FR-1: the sync window is judged on the LAST step', () => {
    it('Sync in step 4: the preview says open (round 2, position 4), the start is 202, and the load is recorded with that round and step', async () => {
      useFiveSteps(w, 11);
      scriptFeed(w.feed, { total: 3 });

      const preview = await w.send('get', '/timelines/11/loads/preview');
      const started = await w.send('post', '/timelines/11/loads');
      const [done] = await w.settled(11);

      expect(preview.body.data).toMatchObject({
        window: 'open',
        round: 2,
        stepPosition: 4,
      });
      expect(started.status).toBe(202);
      expect(started.body.data).toEqual({ id: 1, status: 'running' });
      expect(done).toMatchObject({
        id: 1,
        status: 'completed',
        round: 2,
        stepPosition: 4,
      });
      // The memberships entered in the load's round.
      expect(w.loadsWorld.results.map((r) => r.entryRound)).toEqual([2, 2, 2]);
    });

    it('Last closing minute: 202 at 23:59 Rome on the last closing day, 409 LOADS_WINDOW_CLOSED at 00:00 with nothing written, and the preview says closed', async () => {
      useFiveSteps(w, 11, '2026-12-03T23:59');
      scriptFeed(w.feed, { total: 3 });
      // Rome is UTC+1 in December: 22:59Z is 23:59 on 3 Dec.
      w.clock.advance(Date.parse('2026-12-03T22:59:00.000Z') - NOW.getTime());

      const atLastMinute = await w.send('get', '/timelines/11/loads/preview');
      const accepted = await w.send('post', '/timelines/11/loads');
      await w.settled(11);
      w.clock.advance(60 * 1000); // 00:00 on 4 Dec
      const closedPreview = await w.send('get', '/timelines/11/loads/preview');
      const before = nothingRan();
      const refused = await w.send('post', '/timelines/11/loads');

      expect(atLastMinute.body.data.window).toBe('open');
      expect(accepted.status).toBe(202);
      expect(closedPreview.body.data.window).toBe('closed');
      expectError(refused, 409, 'LOADS_WINDOW_CLOSED');
      expect({ ...nothingRan(), feed: before.feed }).toEqual(before);
    });

    it('Before step 1 opens: the sync is accepted as round 1, step position 1', async () => {
      // Step 1 of timeline 12 opens tomorrow (11 Nov 09:00 Rome).
      const stepOne = w.world.steps.find(
        (s) => s.timelineId === 12 && s.position === 1,
      )!;
      stepOne.opensAt = minute('2026-11-11T09:00');
      scriptFeed(w.feed, { total: 3 });

      const preview = await w.send('get', '/timelines/12/loads/preview');
      const started = await w.send('post', '/timelines/12/loads');
      const [done] = await w.settled(12);

      expect(preview.body.data).toMatchObject({
        window: 'open',
        round: 1,
        stepPosition: 1,
      });
      expect(started.status).toBe(202);
      expect(done).toMatchObject({ round: 1, stepPosition: 1 });
    });

    it('Closed cycle: 409 CYCLES_CLOSED even when the last step has also closed, and no row, audit or key is written', async () => {
      const last = w.world.steps.find(
        (s) => s.timelineId === 31 && s.position === 3,
      )!;
      last.closesAt = minute('2026-11-01T17:30');
      scriptFeed(w.feed, { total: 3 });
      const before = nothingRan();

      const res = await w.send('post', '/timelines/31/loads', {
        key: 'closed-1',
      });

      expectError(res, 409, 'CYCLES_CLOSED');
      expect({ ...nothingRan(), feed: before.feed }).toEqual(before);
    });
  });

  describe('FR-4, FR-7, FR-9, FR-10: a round-2 sync re-admits a result returned through the store', () => {
    // Round 1 (step 1) loads 1001-1005: 1001 and 1002 are KPs (released as
    // QAed, so their memberships end), 1003-1005 are policy changes of SP02.
    // No HTTP route returns a result (FR-6): 1003 and 1004 are returned through
    // `LoadsStore.endAsReturned` on 11 Nov 11:00 Rome. Then step 3, a round-2
    // step, opens (clock on 8 Dec) and the feed lists 1003 re-submitted with a
    // corrected title, 1004 with the date of its return, and 1005 still active.
    const RETURNED_AT = new Date('2026-11-11T10:00:00.000Z');
    const ROUND_2_CLOCK = Date.parse('2026-12-08T09:00:00.000Z');

    const prepareRoundTwo = async () => {
      scriptFeed(w.feed, { total: 5, kps: 2 });
      expect((await w.send('post', '/timelines/11/loads')).status).toBe(202);
      await w.settled(11);
      const roundOne = new Map(
        w.loadsWorld.results.map((r) => [r.resultCode, r]),
      );
      for (const code of [1003, 1004]) {
        expect(
          await w.loadsWorld.store.endAsReturned(
            roundOne.get(code)!.id,
            RETURNED_AT,
          ),
        ).toEqual({ ended: true });
      }
      w.world.steps.find((s) => s.id === 113)!.round = 2;
      w.clock.advance(ROUND_2_CLOCK - NOW.getTime());
      const listed = w.feed.list.bind(w.feed);
      w.feed.list = async (query) => {
        const page = await listed(query);
        const submittedAt: Record<number, string> = {
          1003: '2026-11-12T09:00:00.000Z',
          1004: '2026-11-11T10:00:00.000Z',
        };
        return {
          ...page,
          items: page.items.map((item) => ({
            ...item,
            submittedAt: submittedAt[item.resultCode] ?? item.submittedAt,
          })),
        };
      };
      const detailed = w.feed.details.bind(w.feed);
      w.feed.details = async (query) => {
        const details = await detailed(query);
        return {
          ...details,
          results: details.results.map((result) =>
            result.resultId === 5003
              ? {
                  ...result,
                  values: { title: 'Result title 5003, corrected' },
                }
              : result,
          ),
        };
      };
      return { roundOne, callsBefore: w.feed.calls.length };
    };

    it('the preview says round 2, one result re-submitted, two returned and not re-submitted, and what it would skip', async () => {
      await prepareRoundTwo();

      const res = await w.send('get', '/timelines/11/loads/preview');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        phaseYear: 2026,
        window: 'open',
        round: 2,
        stepPosition: 3,
        toLoad: {
          total: 1,
          new: 0,
          resubmitted: 1,
          byProgram: [{ programId: 2, code: 'SP02', count: 1 }],
          byResultType: [{ key: 'policy_change', count: 1 }],
        },
        // 1003 and 1004 were returned here; 1003 is taken as re-submitted, so
        // the sync gives it a round-2 membership and only 1004 is counted.
        returnedNotResubmitted: {
          total: 1,
          byProgram: [{ programId: 2, code: 'SP02', count: 1 }],
          byResultType: [{ key: 'policy_change', count: 1 }],
        },
        kpGroups: { notInQa: 0, autoChecked: 0, review: 0 },
        skipped: [
          { reason: 'ALREADY_IN_THIS_TIMELINE', count: 3 },
          { reason: 'RETURNED_NOT_RESUBMITTED', count: 1 },
        ],
      });
    });

    it('the preview and the sync that follows count the same returned and not re-submitted results (FR-9: the same counts)', async () => {
      await prepareRoundTwo();

      const preview = await w.send('get', '/timelines/11/loads/preview');
      await w.send('post', '/timelines/11/loads');
      await w.settled(11);
      const detail = await w.send('get', '/timelines/11/loads/2');

      const counted = preview.body.data.returnedNotResubmitted as {
        total: number;
        byProgram: Array<{ programId: number; code?: string; count: number }>;
        byResultType: unknown[];
      };
      // The preview names a program's code where the feed still lists it; the stored summary does not.
      expect({
        ...counted,
        byProgram: counted.byProgram.map(({ programId, count }) => ({
          programId,
          count,
        })),
      }).toEqual(detail.body.data.summary.returnedNotResubmitted);
      expect(counted.total).toBe(1);
    });

    it('the sync takes the re-submitted result in round 2: intake and details of it only, a pending membership with its changed fields, no release of it, and the summary counts', async () => {
      const { roundOne, callsBefore } = await prepareRoundTwo();
      const snapshotsBefore = w.snapshots.size;

      const started = await w.send('post', '/timelines/11/loads');
      await w.settled(11);

      expect(started.status).toBe(202);
      expect(started.body.data).toEqual({ id: 2, status: 'running' });
      // Reporting is asked for the re-submitted result only, and nothing is released.
      const calls = w.feed.calls.slice(callsBefore);
      expect(
        calls.filter((c) => c.op === 'intake').map((c) => c.query),
      ).toEqual([{ phaseYear: 2026, resultIds: [5003] }]);
      expect(
        calls.filter((c) => c.op === 'details').map((c) => c.query),
      ).toEqual([{ phaseYear: 2026, resultIds: [5003] }]);
      // The re-submitted result is `pending`, so the KP release never takes it (S-9 a).
      const released = calls
        .filter((c) => c.op === 'release')
        .flatMap((c) =>
          (c.query as { items: Array<{ resultId: number }> }).items.map(
            (item) => item.resultId,
          ),
        );
      expect(released).not.toContain(5003);
      // The new membership: round 2, pending, linked to the returned one, the title changed.
      const entered = w.loadsWorld.results.filter((r) => r.entryRound === 2);
      expect(entered).toHaveLength(1);
      expect(entered[0]).toMatchObject({
        resultCode: 1003,
        loadId: 2,
        status: 'pending',
        kpGroup: null,
        previousMembershipId: roundOne.get(1003)!.id,
        changedFields: ['title'],
        endedAt: null,
        endReason: null,
      });
      // The round-1 membership and its snapshot are untouched; the new snapshot is added.
      expect(roundOne.get(1003)).toMatchObject({
        entryRound: 1,
        endReason: 'returned',
        endedAt: RETURNED_AT,
      });
      expect(w.snapshots.size).toBe(snapshotsBefore + 1);

      const list = await w.send('get', '/timelines/11/loads');
      const detail = await w.send('get', '/timelines/11/loads/2');
      expect(
        (
          list.body.data as Array<{
            id: number;
            round: number;
            stepPosition: number;
          }>
        ).map((l) => [l.id, l.round, l.stepPosition]),
      ).toEqual([
        [2, 2, 3],
        [1, 1, 1],
      ]);
      expect(detail.body.data).toMatchObject({
        id: 2,
        status: 'completed',
        round: 2,
        stepPosition: 3,
        total: 5,
        summary: {
          loaded: 1,
          loadedNew: 0,
          loadedResubmitted: 1,
          round: 2,
          byProgram: [{ programId: 2, count: 1 }],
          byResultType: [{ key: 'policy_change', count: 1 }],
          kpGroups: { notInQa: 0, autoChecked: 0, review: 0 },
          // 1003 has its round-2 membership now: only 1004 is still returned and not re-submitted.
          returnedNotResubmitted: {
            total: 1,
            byProgram: [{ programId: 2, count: 1 }],
            byResultType: [{ key: 'policy_change', count: 1 }],
          },
          skipped: [
            { reason: 'ALREADY_IN_THIS_TIMELINE', count: 3 },
            { reason: 'RETURNED_NOT_RESUBMITTED', count: 1 },
          ],
        },
      });
      // The changed fields are stored for the worklist, not exposed by any route.
      expect(
        JSON.stringify([list.body, detail.body]).toLowerCase(),
      ).not.toContain('changedfields');
    });
  });

  describe('OpenAPI: the answers and the document say the same fields (FR-9, FR-10)', () => {
    type Schema = {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const schemas = () =>
      (
        buildOpenApiDocument(w.app) as unknown as {
          components: { schemas: Record<string, Schema> };
        }
      ).components.schemas;

    /** Every key of a real answer is documented, and every required documented key is in the answer. */
    const expectDocumented = (
      model: string,
      answer: Record<string, unknown>,
    ) => {
      const schema = schemas()[model];
      expect(schema, `${model} is not in the document`).toBeDefined();
      const documented = Object.keys(schema!.properties ?? {});
      expect(documented, model).toEqual(
        expect.arrayContaining(Object.keys(answer)),
      );
      expect(Object.keys(answer), model).toEqual(
        expect.arrayContaining(schema!.required ?? []),
      );
    };

    it('documents round, stepPosition and the new counts exactly where the answers carry them', async () => {
      scriptFeed(w.feed, { total: 3 });
      const preview = await w.send('get', '/timelines/11/loads/preview');
      await w.send('post', '/timelines/11/loads');
      await w.settled(11);
      const list = await w.send('get', '/timelines/11/loads');
      const detail = await w.send('get', '/timelines/11/loads/1');

      // The fields the spec adds, by name, so a model that drops one is red.
      expect(Object.keys(list.body.data[0])).toEqual(
        expect.arrayContaining(['round', 'stepPosition']),
      );
      expectDocumented('LoadPreviewModel', preview.body.data);
      expectDocumented('ToLoadModel', preview.body.data.toLoad);
      expectDocumented(
        'ReturnedNotResubmittedModel',
        preview.body.data.returnedNotResubmitted,
      );
      expectDocumented('LoadItemModel', list.body.data[0]);
      expectDocumented('LoadDetailModel', detail.body.data);
      expectDocumented('LoadSummaryModel', detail.body.data.summary);
      expect(schemas()['LoadItemModel']!.required).toEqual(
        expect.arrayContaining(['round', 'stepPosition']),
      );
      expect(schemas()['LoadSummaryModel']!.required).toEqual(
        expect.arrayContaining([
          'loadedNew',
          'loadedResubmitted',
          'round',
          'returnedNotResubmitted',
        ]),
      );
    });
  });

  describe('FR-10: GET /timelines/:id/loads and /:loadId', () => {
    it('lists the loads newest first and reads one with its summary', async () => {
      scriptFeed(w.feed, { total: 5, kps: 2 });
      const first = await w.send('post', '/timelines/11/loads');
      await w.settled(11);
      // The second load finds all five already in the timeline: it skips them.
      const second = await w.send('post', '/timelines/11/loads');
      await w.settled(11);

      const list = await w.send('get', '/timelines/11/loads');
      const one = await w.send(
        'get',
        `/timelines/11/loads/${first.body.data.id}`,
      );
      const two = await w.send(
        'get',
        `/timelines/11/loads/${second.body.data.id}`,
      );

      expect(list.status).toBe(200);
      expect(
        (list.body.data as Array<{ id: number }>).map((l) => l.id),
      ).toEqual([2, 1]);
      expect(list.body.data[1]).toEqual({
        id: 1,
        status: 'completed',
        total: 5,
        processed: 5,
        startedAt: '2026-11-10T08:00:00.000Z',
        finishedAt: expect.any(String),
        startedBy: { id: w.admin.id, nickname: ADMIN_NICKNAME },
        failureReason: null,
        round: 1,
        stepPosition: 1,
      });
      expect(one.status).toBe(200);
      expect(one.body.data).toEqual({
        ...list.body.data[1],
        summary: {
          loaded: 5,
          loadedNew: 5,
          loadedResubmitted: 0,
          round: 1,
          returnedNotResubmitted: { total: 0, byProgram: [], byResultType: [] },
          byProgram: [{ programId: 2, count: 5 }],
          byResultType: [
            { key: 'knowledge_product', count: 2 },
            { key: 'policy_change', count: 3 },
          ],
          kpGroups: { notInQa: 2, autoChecked: 0, review: 0 },
          skipped: [],
        },
      });
      expect(two.body.data.summary).toMatchObject({
        loaded: 0,
        skipped: [{ reason: 'ALREADY_IN_THIS_TIMELINE', count: 5 }],
      });
    });

    it('an empty timeline lists []', async () => {
      const res = await w.send('get', '/timelines/12/loads');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('a running load whose heartbeat expired reads failed / ABANDONED', async () => {
      w.loadsWorld.loads.push({
        id: 9,
        cycleId: 1,
        timelineId: 11,
        timelineStepId: 111,
        round: 1,
        stepPosition: 1,
        phaseYear: 2026,
        scope: {
          allPrograms: false,
          programIds: [2],
          allResultTypes: false,
          resultTypeKeys: ['policy_change'],
        },
        status: 'running',
        runningKey: 1,
        total: 10,
        processed: 4,
        summary: null,
        failureReason: null,
        startedBy: w.admin.id,
        startedAt: new Date('2026-11-10T07:00:00.000Z'),
        heartbeatAt: new Date('2026-11-10T07:30:00.000Z'),
        finishedAt: null,
        requestId: 'req-old',
      });

      const res = await w.send('get', '/timelines/11/loads/9');

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: 9,
        status: 'failed',
        failureReason: 'ABANDONED',
        // A load from before rounds (no summary, default columns) reads round 1, step 1 (FR-10).
        round: 1,
        stepPosition: 1,
        summary: {
          loaded: 0,
          loadedNew: 0,
          loadedResubmitted: 0,
          round: 1,
          returnedNotResubmitted: { total: 0, byProgram: [], byResultType: [] },
        },
      });
    });

    it("404 TIMELINES_NOT_FOUND for the list and the read, 404 LOADS_NOT_FOUND for a load that is not there or is another timeline's", async () => {
      scriptFeed(w.feed, { total: 2 });
      await w.send('post', '/timelines/11/loads');
      await w.settled(11);

      expectError(
        await w.send('get', '/timelines/999/loads'),
        404,
        'TIMELINES_NOT_FOUND',
      );
      expectError(
        await w.send('get', '/timelines/999/loads/1'),
        404,
        'TIMELINES_NOT_FOUND',
      );
      expectError(
        await w.send('get', '/timelines/11/loads/77'),
        404,
        'LOADS_NOT_FOUND',
      );
      expectError(
        await w.send('get', '/timelines/12/loads/1'),
        404,
        'LOADS_NOT_FOUND',
      );
    });

    it.each(['abc', '0', '-1'])(
      '400 VALIDATION_FAILED on `loadId` for %s',
      async (loadId) => {
        const res = await w.send('get', `/timelines/11/loads/${loadId}`);

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.fields[0].field).toBe('loadId');
      },
    );
  });
});
