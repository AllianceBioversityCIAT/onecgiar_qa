// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import request from 'supertest';
import {
  ADMIN_NICKNAME,
  bearer,
  buildIngestionApp,
  closeAllStepsOfTimeline13,
  NOW,
  type IngestionApp,
} from './support/ingestion-app.js';
import { LogSpy } from './support/log-spy.js';

// ingestion/step-1-loads T-9 (NFR-1, NFR-2, FR-12): over the four routes, a
// forced 5xx, a Reporting 401 and a request with no token, nothing secret and
// nothing personal reaches any log line or any answer, and each request that
// reaches a handler writes exactly one `ingestion` line with ids and fixed
// words. The adapter is the real `ReportingResultsFeedClient` over a stubbed
// `fetch`, so the Reporting key really travels in `x-api-key` and the stub can
// echo it back in a refusal body: "the key is not in the logs" is then proven
// against a key that was in play. The spy captures every sink (all `Logger`
// instances, the static logger, `console`, stdout and stderr), not one.
// Expected values are written out from the design (§ 7.8).

const REPORTING_KEY = 'test-catalog-key';
const KEY_PREFIX = 'Sensitive-Load-Key';
const INTERNAL_SECRET = 'db-exploded-sk-live-0042';
const TITLE = 'Private result title';
const TITLE_CORRECTED = 'Corrected sensitive title';
const DECISION_FIELDS = [
  'event',
  'outcome',
  'requestId',
  'route',
  'timelineId',
];

/** The URL of whatever `fetch` was given. */
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );

type ReportingMode = 'ok' | 'down' | 'unauthorized';

describe('NFR-1 / NFR-2 / FR-12: loads log ids and fixed words only', () => {
  let w: IngestionApp;
  const spy = new LogSpy();
  const reporting = {
    mode: 'ok' as ReportingMode,
    /** Results the feed lists as submitted again after a return, and whose title Reporting now corrects. */
    resubmitted: new Set<number>(),
  };
  const upstream: Array<{ path: string; key: string | undefined }> = [];
  let secrets: string[];
  let serial = 0;

  /** A contract-shaped Reporting: the key is echoed into its refusals, a title into its details. */
  const stubReporting = () =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      upstream.push({ path: url.pathname, key: headers['x-api-key'] });
      if (reporting.mode === 'down') {
        return new Response(`upstream down, key ${REPORTING_KEY}`, {
          status: 503,
        });
      }
      if (reporting.mode === 'unauthorized') {
        return new Response(
          JSON.stringify({ message: `invalid key ${REPORTING_KEY}` }),
          { status: 401 },
        );
      }
      const ids = [5001, 5002, 5003];
      if (url.pathname.endsWith('/qa/results')) {
        const size = Number(url.searchParams.get('page_size'));
        return Response.json({
          phase: 2026,
          page: Number(url.searchParams.get('page')),
          page_size: size,
          total: ids.length,
          breakdown: { by_program: [], by_result_type: [] },
          items: ids.slice(0, size).map((id) => ({
            result_id: id,
            result_code: id - 4000,
            program: { clarisa_id: 2, code: 'SP02' },
            result_type_key: 'policy_change',
            submitted_at: reporting.resubmitted.has(id)
              ? '2026-12-01T09:00:00.000Z'
              : '2026-10-01T00:00:00.000Z',
          })),
        });
      }
      const body = JSON.parse(init?.body as string) as { result_ids: number[] };
      if (url.pathname.endsWith('/qa/results/intake')) {
        return Response.json({
          phase_year: 2026,
          taken: body.result_ids.map((id) => ({
            result_id: id,
            result_code: id - 4000,
            changed: true,
          })),
          not_taken: [],
        });
      }
      return Response.json({
        phase: 2026,
        catalog_version: '1.29',
        results: body.result_ids.map((id) => ({
          result_id: id,
          result_code: id - 4000,
          result_type_key: 'policy_change',
          values: {
            title: `${reporting.resubmitted.has(id) ? TITLE_CORRECTED : TITLE} ${id}`,
          },
        })),
        not_eligible: [],
      });
    });

  beforeEach(async () => {
    spy.lines.length = 0;
    upstream.length = 0;
    reporting.mode = 'ok';
    reporting.resubmitted.clear();
    serial = 0;
    w = await buildIngestionApp({ feed: 'real' });
    spy.attach();
    stubReporting();
    // stdout and stderr too: a `process.stdout.write` would bypass every logger.
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
        spy.lines.push(String(chunk));
        return true;
      }) as never);
    }
    secrets = [
      REPORTING_KEY,
      KEY_PREFIX,
      INTERNAL_SECRET,
      TITLE,
      TITLE_CORRECTED,
      bearer('sub-admin').replace('Bearer ', ''),
      bearer('sub-assessor').replace('Bearer ', ''),
      'not-a-token',
      'sub-admin@cgiar.org',
      ADMIN_NICKNAME,
      'Secondnick',
    ].map((s) => s.toLowerCase());
  });

  afterEach(async () => {
    try {
      await w.settled(11);
    } catch {
      // Nothing started, or Reporting is down: there is no run to wait for.
    }
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  const newKey = () => `${KEY_PREFIX}-${++serial}`;
  const requestIdOf = (res: request.Response) =>
    res.headers['x-request-id'] as string;

  const expectNoSecret = () => {
    const haystack = spy.lines.join('\n').toLowerCase();
    for (const secret of secrets) expect(haystack).not.toContain(secret);
  };

  /** Every captured line that names this request, whatever its event. */
  const linesOf = (requestId: string) =>
    spy.lines.filter((line) => line.includes(requestId));

  /** The answer must not carry the key or a person either (an error body is read by the browser). */
  const expectCleanAnswer = (res: request.Response) => {
    const text = res.text.toLowerCase();
    for (const secret of [
      REPORTING_KEY,
      INTERNAL_SECRET,
      'sub-admin@cgiar.org',
    ])
      expect(text).not.toContain(secret.toLowerCase());
  };

  it('the Reporting key is really sent to Reporting on a start (so the checks below are against a key in play)', async () => {
    const res = await w.send('post', '/timelines/11/loads');
    expect(res.status).toBe(202);
    await w.settled(11);

    expect(upstream.length).toBeGreaterThan(0);
    for (const call of upstream) expect(call.key).toBe(REPORTING_KEY);
    expect(upstream.map((c) => c.path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/qa\/results$/),
        expect.stringMatching(/\/qa\/results\/intake$/),
        expect.stringMatching(/\/qa\/results\/details$/),
      ]),
    );
  });

  it('every route: exactly one ingestion line for the request, with ids and fixed words, and nothing secret anywhere', async () => {
    const calls: Array<[string, 'get' | 'post', string, number, string?]> = [
      ['preview', 'get', '/timelines/11/loads/preview', 200],
      ['start', 'post', '/timelines/11/loads', 202, newKey()],
    ];
    for (const [route, method, path, status, key] of calls) {
      const res = await w.send(method, path, { key });
      expect(res.status, route).toBe(status);
      const events = spy.eventsOf('ingestion', requestIdOf(res));
      expect(events, route).toEqual([
        {
          event: 'ingestion',
          route,
          timelineId: 11,
          outcome: 'ok',
          requestId: requestIdOf(res),
        },
      ]);
      expect(Object.keys(events[0]!).sort(), route).toEqual(DECISION_FIELDS);
      expect(linesOf(requestIdOf(res)), route).toHaveLength(1);
    }
    await w.settled(11);

    const list = await w.send('get', '/timelines/11/loads');
    const one = await w.send('get', '/timelines/11/loads/1');
    for (const [route, res] of [
      ['list', list],
      ['get', one],
    ] as const) {
      expect(res.status, route).toBe(200);
      expect(spy.eventsOf('ingestion', requestIdOf(res)), route).toEqual([
        {
          event: 'ingestion',
          route,
          timelineId: 11,
          outcome: 'ok',
          requestId: requestIdOf(res),
        },
      ]);
      expect(linesOf(requestIdOf(res)), route).toHaveLength(1);
    }
    // The answer carries the person (the point of the list); the logs never do.
    expect(list.body.data[0].startedBy.nickname).toBe(ADMIN_NICKNAME);

    // The runner wrote its lines (per lot and at the end) with ids and counts only.
    const runner = spy.lines.filter((l) => l.includes('"route":"run"'));
    expect(runner.length).toBeGreaterThan(0);
    for (const line of runner) {
      expect(JSON.parse(line)).toMatchObject({ event: 'ingestion', loadId: 1 });
    }
    expectNoSecret();
  });

  // Timeline-sync T-7 (FR-9, FR-10, FR-11, NFR-4): the new fields of a round-2
  // sync (round, step position, the new/re-submitted split, the returned and not
  // re-submitted count) are counts and ids; no title, no person and no changed
  // field reaches a line or an answer. No HTTP route returns a result (FR-6), so
  // the return goes through the store, as the future assessment flow will.
  it('a round-2 sync that re-admits a returned result: the new fields in the answers and the lines carry no title, person or changed field', async () => {
    const first = await w.send('post', '/timelines/11/loads', {
      key: newKey(),
    });
    expect(first.status).toBe(202);
    await w.settled(11);
    for (const row of w.loadsWorld.results.filter((r) =>
      [1001, 1002].includes(r.resultCode),
    )) {
      await w.loadsWorld.store.endAsReturned(
        row.id,
        new Date('2026-11-11T10:00:00.000Z'),
      );
    }
    w.world.steps.find((step) => step.id === 113)!.round = 2;
    w.clock.advance(Date.parse('2026-12-08T09:00:00.000Z') - NOW.getTime());
    // 1001 is re-submitted with a corrected title; 1002 is not.
    reporting.resubmitted.add(5001);
    spy.lines.length = 0;

    const preview = await w.send('get', '/timelines/11/loads/preview');
    const start = await w.send('post', '/timelines/11/loads', {
      key: newKey(),
    });
    await w.settled(11);
    const list = await w.send('get', '/timelines/11/loads');
    const detail = await w.send('get', '/timelines/11/loads/2');

    // The new fields are really in play (so the checks below are not vacuous).
    expect(preview.body.data).toMatchObject({
      round: 2,
      stepPosition: 3,
      toLoad: { total: 1, new: 0, resubmitted: 1 },
      // 1001 is taken as re-submitted; only 1002 is counted, as the sync will.
      returnedNotResubmitted: { total: 1 },
    });
    expect(start.status).toBe(202);
    expect(detail.body.data).toMatchObject({
      round: 2,
      stepPosition: 3,
      summary: {
        loadedResubmitted: 1,
        round: 2,
        returnedNotResubmitted: { total: 1 },
      },
    });
    expect(w.loadsWorld.results.find((r) => r.loadId === 2)).toMatchObject({
      resultCode: 1001,
      changedFields: ['title'],
    });
    // The answers: no title, original or corrected, and no changed field.
    for (const res of [preview, start, list, detail]) {
      const text = res.text.toLowerCase();
      for (const word of [
        TITLE,
        TITLE_CORRECTED,
        'changedfields',
        'changed_fields',
      ])
        expect(text).not.toContain(word.toLowerCase());
      expectCleanAnswer(res);
    }
    // The service lines keep their fields: ids and fixed words, one line per request.
    for (const [route, res] of [
      ['preview', preview],
      ['start', start],
    ] as const) {
      const events = spy.eventsOf('ingestion', requestIdOf(res));
      expect(events, route).toEqual([
        {
          event: 'ingestion',
          route,
          timelineId: 11,
          outcome: 'ok',
          requestId: requestIdOf(res),
        },
      ]);
      expect(Object.keys(events[0]!).sort(), route).toEqual(DECISION_FIELDS);
    }
    // The runner's lines carry the round as a number, and never a changed field.
    const runner = spy.lines
      .filter((l) => l.includes('"route":"run"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(runner.length).toBeGreaterThan(0);
    expect(runner.some((line) => line.round === 2)).toBe(true);
    for (const line of runner)
      expect(['undefined', 'number']).toContain(typeof line.round);
    const everything = spy.lines.join('\n').toLowerCase();
    expect(everything).not.toContain('changedfields');
    expect(everything).not.toContain('changed_fields');
    expect(everything).not.toContain('"title"');
    expectNoSecret();
  });

  it('a replayed start writes the replay line only, and the key is in no line', async () => {
    const key = newKey();
    const first = await w.send('post', '/timelines/11/loads', { key });
    await w.settled(11);
    spy.lines.length = 0;

    const replay = await w.send('post', '/timelines/11/loads', { key });

    expect(replay.status).toBe(202);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual(first.body.data);
    const id = requestIdOf(replay);
    expect(spy.eventsOf('ingestion', id)).toHaveLength(0);
    expect(spy.eventsOf('idempotency', id)).toEqual([
      {
        event: 'idempotency',
        idempotency: 'replayed',
        outcome: 'replayed',
        status: 202,
        actorId: w.admin.id,
        requestId: id,
      },
    ]);
    expect(linesOf(id)).toHaveLength(1);
    expectNoSecret();
  });

  it('refusals (404, 409, 400) write one refused line with the catalog code, and nothing secret', async () => {
    // Timeline 13: the last step closed one minute before the clock (FR-1).
    closeAllStepsOfTimeline13(w);
    const cases: Array<[string, 'get' | 'post', string, number, string]> = [
      [
        'preview',
        'get',
        '/timelines/999/loads/preview',
        404,
        'TIMELINES_NOT_FOUND',
      ],
      ['start', 'post', '/timelines/13/loads', 409, 'LOADS_WINDOW_CLOSED'],
      ['start', 'post', '/timelines/31/loads', 409, 'CYCLES_CLOSED'],
      ['get', 'get', '/timelines/11/loads/77', 404, 'LOADS_NOT_FOUND'],
    ];
    for (const [route, method, path, status, code] of cases) {
      const res = await w.send(method, path, { key: newKey() });
      expect(res.status, path).toBe(status);
      expect(res.body.error.code, path).toBe(code);
      const events = spy.eventsOf('ingestion', requestIdOf(res));
      expect(events, path).toEqual([
        {
          event: 'ingestion',
          route,
          timelineId: Number(path.split('/')[2]),
          outcome: 'refused',
          reason: code,
          requestId: requestIdOf(res),
        },
      ]);
    }
    expectNoSecret();
  });

  it('a 400 on an id and a 401 probe (no token, a bad token) write no ingestion line and print no credential', async () => {
    const bad = await w.send('get', '/timelines/abc/loads/preview');
    const noToken = await w.send('get', '/timelines/11/loads', { token: null });
    const badToken = await w.send('post', '/timelines/11/loads', {
      token: 'Bearer not-a-token',
      key: newKey(),
    });

    expect(bad.status).toBe(400);
    expect(noToken.status).toBe(401);
    expect(badToken.status).toBe(401);
    for (const res of [bad, noToken, badToken]) {
      expect(spy.eventsOf('ingestion', requestIdOf(res))).toHaveLength(0);
    }
    expectNoSecret();
  });

  it('a non-admin (403) writes no ingestion line, Reporting is not called, and its token is in no line', async () => {
    const res = await w.send('post', '/timelines/11/loads', {
      token: bearer('sub-assessor'),
      key: newKey(),
    });

    expect(res.status).toBe(403);
    expect(spy.eventsOf('ingestion', requestIdOf(res))).toHaveLength(0);
    expect(upstream).toEqual([]);
    expectNoSecret();
  });

  it('a forced 5xx (an internal error that carries a secret in its message) is logged without the message, and answered without it', async () => {
    vi.spyOn(w.loadsWorld.store, 'listByTimeline').mockRejectedValue(
      new Error(`connection lost near ${INTERNAL_SECRET}`),
    );

    const res = await w.send('get', '/timelines/11/loads');

    expect(res.status).toBe(500);
    const id = requestIdOf(res);
    expect(spy.eventsOf('ingestion', id)).toEqual([
      {
        event: 'ingestion',
        route: 'list',
        timelineId: 11,
        outcome: 'error',
        reason: 'internal_error',
        requestId: id,
      },
    ]);
    expectCleanAnswer(res);
    expectNoSecret();
  });

  it.each(['down', 'unauthorized'] as const)(
    'Reporting %s at the start check: 503, the refusal body that echoed the key is in no line and no answer, and nothing is written',
    async (mode) => {
      reporting.mode = mode;

      const res = await w.send('post', '/timelines/11/loads', {
        key: newKey(),
      });
      const preview = await w.send('get', '/timelines/11/loads/preview');

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(preview.status).toBe(503);
      expect(upstream.length).toBeGreaterThan(0);
      expect(w.loadsWorld.loads).toHaveLength(0);
      const id = requestIdOf(res);
      expect(spy.eventsOf('ingestion', id)).toEqual([
        {
          event: 'ingestion',
          route: 'start',
          timelineId: 11,
          outcome: 'error',
          reason: 'SERVICE_UNAVAILABLE',
          requestId: id,
        },
      ]);
      expectCleanAnswer(res);
      expectCleanAnswer(preview);
      expectNoSecret();
    },
  );

  it('Reporting turns unauthorized in the middle of a run: the load fails and no line or read of it holds the key', async () => {
    const original = globalThis.fetch;
    // The probe answers; every call after it is a 401 that echoes the key.
    let calls = 0;
    vi.mocked(original).mockImplementation(async (input, init) => {
      calls++;
      if (calls === 1) {
        const url = urlOf(input);
        return Response.json({
          phase: 2026,
          page: 1,
          page_size: Number(url.searchParams.get('page_size')),
          total: 3,
          breakdown: { by_program: [], by_result_type: [] },
          items: [],
        });
      }
      void init;
      return new Response(
        JSON.stringify({ message: `invalid key ${REPORTING_KEY}` }),
        {
          status: 401,
        },
      );
    });

    const res = await w.send('post', '/timelines/11/loads', { key: newKey() });
    const [load] = await w.settled(11);
    const read = await w.send('get', '/timelines/11/loads/1');

    expect(res.status).toBe(202);
    expect(load).toMatchObject({ status: 'failed' });
    expect(read.body.data.failureReason).toBe('REPORTING_UNAUTHORIZED');
    expectCleanAnswer(read);
    expectNoSecret();
  });
});
