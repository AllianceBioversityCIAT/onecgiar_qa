// @akili-spec ingestion/step-1-loads
import request from 'supertest';
import { FeedError } from '../src/ingestion/results-feed.port.js';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import {
  ADMIN_NICKNAME,
  bearer,
  buildIngestionApp,
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
// 09:00). Expected values are the spec's, written out.

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
        toLoad: {
          total: 5,
          byProgram: [{ programId: 2, code: 'SP02', count: 5 }],
          byResultType: [
            { key: 'knowledge_product', count: 2 },
            { key: 'policy_change', count: 3 },
          ],
        },
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

    it('says the window is closed when step 1 has closed, and when the cycle is closed', async () => {
      scriptFeed(w.feed, { total: 1 });

      const stepClosed = await w.send('get', '/timelines/13/loads/preview');
      const cycleClosed = await w.send('get', '/timelines/31/loads/preview');

      expect(stepClosed.body.data.window).toBe('closed');
      expect(cycleClosed.body.data.window).toBe('closed');
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

    it('409 LOADS_WINDOW_CLOSED one minute after step 1 closes, and no load row', async () => {
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
      });
      expect(one.status).toBe(200);
      expect(one.body.data).toEqual({
        ...list.body.data[1],
        summary: {
          loaded: 5,
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
