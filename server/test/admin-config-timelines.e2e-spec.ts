import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { TimelinesController } from '../src/admin-config/timelines/timelines.controller.js';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';
import { REQUIRE_PERMISSION_KEY } from '../src/auth/decorators/require-permission.decorator.js';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import {
  bearer,
  buildAdminConfigApp,
  type AdminConfigApp,
} from './support/admin-config-app.js';
import { LogSpy } from './support/log-spy.js';

// Timelines over the real app (cycle-timelines T-6 and T-7: the defaults, the
// create, the list and the detail): FR-4 (defaults), FR-5 (official or
// additional, two at once, closed or unknown cycle, kind sent), FR-6 (name,
// scope, catalog down), FR-11 (every problem at once), FR-12 (list and detail
// by date, with the clock overridden), FR-13 (readiness), FR-16 (admin only),
// FR-17 (safe retries), NFR-1, NFR-2, NFR-3, NFR-5, NFR-7. The guards, the pipe, the filter, the idempotency interceptor
// and OpenAPI are real; the stores, the catalog sources and the clocks are the
// in-memory world (today in Rome is 2026-10-20). Expected values are the
// spec's, written out.

const ISO = '2026-10-20T10:00:00.000Z';
const NON_ADMINS = [
  'ASSESSOR',
  'LEAD_ASSESSOR',
  'TPB',
  'PPU',
  'GUEST',
  'MULTI_GRANT',
] as const;

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

/** A valid body: SP02 and one result type, two steps. */
const body = (over: Record<string, unknown> = {}) => ({
  name: 'July 2026',
  allPrograms: false,
  programIds: [2],
  allResultTypes: false,
  resultTypeKeys: ['INNOVATION_DEV'],
  steps: [STEP_1, STEP_2],
  ...over,
});

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

const fieldsOf = (res: request.Response): Array<[string, string]> =>
  (res.body.error.fields as Array<{ field: string; code: string }>).map(
    ({ field, code }) => [field, code],
  );

describe('Timelines routes: defaults, create, list and detail (e2e)', () => {
  let w: AdminConfigApp;
  let spy: LogSpy;

  beforeEach(async () => {
    w = await buildAdminConfigApp();
    spy = new LogSpy();
    spy.attach();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  const createCycle = async (year: number) => {
    const res = await w.send('post', '/cycles', { body: { year } });
    expect(res.status, `create cycle ${year}`).toBe(201);
    return res.body.data.id as number;
  };
  const activateCycle = async (id: number) => {
    const res = await w.send('post', `/cycles/${id}/activate`);
    expect(res.status, `activate ${id}`).toBe(200);
  };
  const createTimeline = (
    cycleId: number,
    over: Record<string, unknown> = {},
    options: { key?: string; token?: string | null } = {},
  ) =>
    w.send('post', `/cycles/${cycleId}/timelines`, {
      body: body(over),
      ...options,
    });
  /** A create whose JSON body never carries the given keys: absent, not `undefined`, not `[]`. */
  const createTimelineWithout = (
    cycleId: number,
    omit: string[],
    over: Record<string, unknown> = {},
  ) => {
    const sent: Record<string, unknown> = body(over);
    for (const key of omit) delete sent[key];
    for (const key of omit) expect(Object.keys(sent)).not.toContain(key);
    return w.send('post', `/cycles/${cycleId}/timelines`, { body: sent });
  };
  /** Everything a create writes, as one string: equal strings = nothing written. */
  const rows = () =>
    JSON.stringify([
      w.world.timelines,
      w.world.steps,
      w.world.programs,
      w.world.resultTypes,
    ]);
  const nothingRan = () => ({
    rows: rows(),
    begun: w.timelinesUnitOfWork.begun,
    reads: w.world.timelineReads,
    log: [...w.world.timelineWriteLog],
  });

  // --- FR-4: the default steps -------------------------------------------------

  describe('FR-4: GET /timeline-defaults', () => {
    it('answers the five default steps of the FR-4 table', async () => {
      const res = await w.send('get', '/timeline-defaults');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toEqual([
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

  // --- FR-16, NFR-1: every route is admin only --------------------------------

  describe('FR-16: access', () => {
    type Route = [
      'defaults' | 'create' | 'list' | 'detail',
      'get' | 'post',
      string,
      object?,
    ];
    const ROUTES: Route[] = [
      ['defaults', 'get', '/timeline-defaults'],
      ['create', 'post', '/cycles/1/timelines', body()],
      ['list', 'get', '/cycles/1/timelines'],
      ['detail', 'get', '/timelines/1'],
    ];

    it('has a 403 row for every grantable role (a new role without one fails here)', () => {
      const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
      for (const { code } of GRANTABLE_ROLES) {
        expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
      }
    });

    it.each(ROUTES)(
      '%s: 401 without a token, and with a token that is not valid, before anything else',
      async (_name, method, path, payload) => {
        await createCycle(2030);
        const before = nothingRan();

        for (const token of [null, 'Bearer not-a-token']) {
          const res = await w.send(method, path, {
            token,
            ...(payload ? { body: payload } : {}),
          });
          expectError(res, 401, 'AUTH_TOKEN_INVALID');
        }

        expect(nothingRan()).toEqual(before);
      },
    );

    for (const role of NON_ADMINS) {
      it.each(ROUTES)(
        `%s: ${role} gets 403 AUTH_PERMISSION_DENIED and nothing is read or written`,
        async (_name, method, path, payload) => {
          await createCycle(2030);
          const before = nothingRan();
          const catalogCalls = { ...w.catalogs };

          const res = await w.send(method, path, {
            token: bearer(`sub-${role.toLowerCase()}`),
            ...(payload ? { body: payload } : {}),
          });

          expectError(res, 403, 'AUTH_PERMISSION_DENIED');
          expect(nothingRan()).toEqual(before);
          expect(w.catalogs).toEqual(catalogCalls);
        },
      );
    }

    it('an ADMIN gets through every route (so a route that lost its guard decision fails here)', async () => {
      const cycleId = await createCycle(2031);

      const defaults = await w.send('get', '/timeline-defaults');
      const created = await createTimeline(cycleId);
      const list = await w.send('get', `/cycles/${cycleId}/timelines`);
      const detail = await w.send('get', `/timelines/${created.body.data.id}`);

      expect([
        defaults.status,
        created.status,
        list.status,
        detail.status,
      ]).toEqual([200, 201, 200, 200]);
    });

    it('declares ADMIN_ACCESS on each of its 4 routes and none as public', () => {
      const reflector = new Reflector();
      const served = Object.getOwnPropertyNames(TimelinesController.prototype)
        .map((name) => TimelinesController.prototype[name as never] as unknown)
        .filter(
          (handler): handler is (...args: never[]) => unknown =>
            typeof handler === 'function',
        )
        .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
        .map((handler) => ({
          route: `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} ${
            Reflect.getMetadata(PATH_METADATA, handler) as string
          }`,
          permission: reflector.getAllAndOverride(REQUIRE_PERMISSION_KEY, [
            handler,
            TimelinesController,
          ]),
          isPublic: reflector.getAllAndOverride(IS_PUBLIC_KEY, [
            handler,
            TimelinesController,
          ]),
        }))
        .sort((a, b) => a.route.localeCompare(b.route));

      expect(served).toEqual([
        {
          route: 'GET cycles/:id/timelines',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
        {
          route: 'GET timeline-defaults',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
        {
          route: 'GET timelines/:id',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
        {
          route: 'POST cycles/:id/timelines',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
      ]);
    });
  });

  // --- FR-5: official or additional ------------------------------------------

  describe('FR-5: POST /cycles/:id/timelines', () => {
    it('makes the first timeline of the cycle official and answers it whole: 201, scope, steps, status, readiness', async () => {
      const cycleId = await createCycle(2026);

      const res = await createTimeline(cycleId);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toEqual({
        id: 1,
        cycleId,
        name: 'July 2026',
        kind: 'official',
        allPrograms: false,
        programIds: [2],
        allResultTypes: false,
        resultTypeKeys: ['INNOVATION_DEV'],
        steps: [
          { position: 1, ...STEP_1 },
          { position: 2, ...STEP_2 },
        ],
        status: 'scheduled',
        currentStep: null,
        nextStep: 1,
        readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
        assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
        createdAt: ISO,
      });
      expect(w.world.timelines[0]).toMatchObject({
        kind: 'official',
        createdBy: w.admin.id,
        createdAt: new Date(ISO),
      });
    });

    it('makes a later timeline additional, and the cycle list counts both with the date range of their steps', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId);

      const second = await createTimeline(cycleId, {
        name: 'September 2026',
        steps: [STEP_1, STEP_2, STEP_3],
      });

      expect(second.status).toBe(201);
      expect(second.body.data).toMatchObject({ id: 2, kind: 'additional' });
      expect(w.world.timelines.map((t) => t.kind)).toEqual([
        'official',
        'additional',
      ]);
      const list = await w.send('get', '/cycles');
      expect(list.body.data[0]).toMatchObject({
        timelineCount: 2,
        startsOn: '2026-11-02',
        endsOn: '2026-11-20',
      });
    });

    it('accepts a timeline in an active cycle', async () => {
      const cycleId = await createCycle(2026);
      await activateCycle(cycleId);

      const res = await createTimeline(cycleId);

      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe('official');
    });

    it('two creates in an empty cycle at the same time: one official, one additional, decided by the lock and never a second official', async () => {
      const cycleId = await createCycle(2026);

      const [a, b] = await Promise.all([
        createTimeline(cycleId, { name: 'July 2026' }),
        createTimeline(cycleId, { name: 'August 2026' }),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(
        [a.body.data.kind, b.body.data.kind].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ).toEqual(['additional', 'official']);
      expect(
        w.world.timelines.filter((t) => t.kind === 'official'),
      ).toHaveLength(1);
      expect(w.world.officialKeyViolations).toBe(0);
    });

    it('refuses a closed cycle with 409 CYCLES_CLOSED and writes nothing', async () => {
      const closed = await createCycle(2026);
      await activateCycle(closed);
      await activateCycle(await createCycle(2027));
      const before = rows();

      const res = await createTimeline(closed);

      expectError(res, 409, 'CYCLES_CLOSED');
      expect(rows()).toBe(before);
      expect(w.world.timelineWriteLog).toEqual([]);
    });

    it('refuses an unknown cycle with 404 CYCLES_NOT_FOUND, and an id that is not a number with 400 on `id`', async () => {
      const unknown = await createTimeline(99);
      const malformed = await w.send('post', '/cycles/abc/timelines', {
        body: body(),
      });

      expectError(unknown, 404, 'CYCLES_NOT_FOUND');
      expectError(malformed, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(malformed)).toEqual([['id', 'INVALID_TYPE']]);
      expect(rows()).toBe(JSON.stringify([[], [], [], []]));
    });

    it.each([
      ['official', { kind: 'official' }],
      ['additional', { kind: 'additional' }],
    ])(
      'a body that says which kind it is (%s) is 400 on `kind` (UNKNOWN_FIELD) and writes nothing',
      async (_label, extra) => {
        const cycleId = await createCycle(2026);
        const before = nothingRan();

        const res = await createTimeline(cycleId, extra);

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res)).toEqual([['kind', 'UNKNOWN_FIELD']]);
        expect(nothingRan()).toEqual(before);
      },
    );

    it('an unknown field inside a step is named with its path', async () => {
      const cycleId = await createCycle(2026);

      const res = await createTimeline(cycleId, {
        steps: [{ ...STEP_1, kind: 'official' }, STEP_2],
      });

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual([['steps[0].kind', 'UNKNOWN_FIELD']]);
    });
  });

  // --- FR-6: name and scope --------------------------------------------------

  describe('FR-6: name and scope', () => {
    it('refuses "july 2026" next to "July 2026" with 409 TIMELINES_NAME_TAKEN, but accepts the same name in another cycle', async () => {
      const first = await createCycle(2026);
      const second = await createCycle(2027);
      await createTimeline(first, { name: 'July 2026' });
      const before = rows();

      const duplicate = await createTimeline(first, { name: 'july 2026' });
      const elsewhere = await createTimeline(second, { name: 'july 2026' });

      expectError(duplicate, 409, 'TIMELINES_NAME_TAKEN');
      expect(elsewhere.status).toBe(201);
      expect(elsewhere.body.data).toMatchObject({
        cycleId: second,
        kind: 'official',
      });
      expect(w.world.timelines).toHaveLength(2);
      expect(before).not.toBe(rows());
    });

    it('stores exactly the programs and the result type asked for', async () => {
      const cycleId = await createCycle(2026);

      const res = await createTimeline(cycleId, {
        programIds: [3, 2],
        resultTypeKeys: ['INNOVATION_DEV'],
      });

      expect(res.body.data).toMatchObject({
        allPrograms: false,
        programIds: [2, 3],
        allResultTypes: false,
        resultTypeKeys: ['INNOVATION_DEV'],
      });
    });

    it('"all" programs and result types are stored as the flags, with no rows', async () => {
      const cycleId = await createCycle(2026);

      const res = await createTimeline(cycleId, {
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        allPrograms: true,
        programIds: [],
        allResultTypes: true,
        resultTypeKeys: [],
      });
      expect(w.world.programs).toEqual([]);
      expect(w.world.resultTypes).toEqual([]);
    });

    it.each<[string, Record<string, unknown>, Array<[string, string]>]>([
      [
        'programs as an empty list',
        { programIds: [] },
        [['programIds', 'REQUIRED']],
      ],
      [
        'result types as an empty list',
        { resultTypeKeys: [] },
        [['resultTypeKeys', 'REQUIRED']],
      ],
      [
        'an unknown program id',
        { programIds: [2, 99] },
        [['programIds', 'INVALID']],
      ],
      [
        'an unknown result type key',
        { resultTypeKeys: ['NOPE'] },
        [['resultTypeKeys', 'INVALID']],
      ],
      [
        '"all" together with a list',
        { allPrograms: true, programIds: [2] },
        [['programIds', 'INVALID']],
      ],
    ])(
      'refuses %s with 400 naming the field, and writes nothing',
      async (_label, over, expected) => {
        const cycleId = await createCycle(2026);
        const before = nothingRan();

        const res = await createTimeline(cycleId, over);

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res)).toEqual(expected);
        expect(nothingRan()).toEqual(before);
      },
    );

    it.each<[string, string, string]>([
      ['programs', 'programIds', 'allPrograms'],
      ['result types', 'resultTypeKeys', 'allResultTypes'],
    ])(
      'a list of %s that is omitted is refused on its field like an empty one, and accepted when "all" is set',
      async (_label, list, all) => {
        const cycleId = await createCycle(2026);
        const before = nothingRan();

        const refused = await createTimelineWithout(cycleId, [list]);
        const everything = await createTimelineWithout(cycleId, [list], {
          [all]: true,
        });

        expectError(refused, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(refused)).toEqual([[list, 'REQUIRED']]);
        expect(everything.status).toBe(201);
        expect(everything.body.data).toMatchObject({ [all]: true, [list]: [] });
        expect(before).not.toEqual(nothingRan());
        expect(w.world.timelines).toHaveLength(1);
      },
    );

    it.each([
      ['the Science Programs catalog', 'programsDown'],
      ['the result types catalog', 'resultTypesDown'],
    ] as const)(
      'when %s cannot be read: 503 SERVICE_UNAVAILABLE and nothing is written',
      async (_label, down) => {
        const cycleId = await createCycle(2026);
        w.catalogs[down] = true;
        const before = nothingRan();

        const res = await createTimeline(cycleId);

        expectError(res, 503, 'SERVICE_UNAVAILABLE');
        expect(nothingRan()).toEqual(before);
      },
    );
  });

  // --- FR-11: every problem at once -----------------------------------------

  describe('FR-11: all errors at once, nothing written', () => {
    it('a request that OMITS `programIds`, with an empty name and a step without `closesOn`, is one 400 listing `name`, `programIds` and `steps[2].closesOn` with catalog messages', async () => {
      const cycleId = await createCycle(2026);
      const { closesOn: _missing, ...noClose } = STEP_3;
      const before = nothingRan();

      const res = await createTimelineWithout(cycleId, ['programIds'], {
        name: '',
        allPrograms: false,
        steps: [STEP_1, STEP_2, noClose],
      });

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
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
      ]);
      expect(nothingRan()).toEqual(before);
    });

    it('the same three problems with `programIds` sent as an empty list come back as the same one 400', async () => {
      const cycleId = await createCycle(2026);
      const { closesOn: _missing, ...noClose } = STEP_3;
      const before = nothingRan();

      const res = await createTimeline(cycleId, {
        name: '',
        programIds: [],
        steps: [STEP_1, STEP_2, noClose],
      });

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
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
      ]);
      expect(nothingRan()).toEqual(before);
    });

    it('both scope lists omitted next to a rule problem are all reported together, in request order', async () => {
      const cycleId = await createCycle(2026);
      const before = nothingRan();

      const res = await createTimelineWithout(
        cycleId,
        ['programIds', 'resultTypeKeys'],
        { name: 'x'.repeat(121) },
      );

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual([
        ['name', 'TOO_LONG'],
        ['programIds', 'REQUIRED'],
        ['resultTypeKeys', 'REQUIRED'],
      ]);
      expect(nothingRan()).toEqual(before);
    });

    it('lists problems of every kind together, in request order, each with the message of the catalog', async () => {
      const cycleId = await createCycle(2026);

      const res = await createTimeline(cycleId, {
        name: 'x'.repeat(121),
        programIds: [99],
        steps: [
          { ...STEP_1, opensOn: '2026-10-19', requiresLoad: false },
          { ...STEP_2, closesOn: '2026-11-08' },
        ],
      });

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
        {
          field: 'name',
          code: 'TOO_LONG',
          message: 'Must be at most 120 characters.',
        },
        {
          field: 'programIds',
          code: 'INVALID',
          message: 'This value is not valid.',
        },
        {
          field: 'steps[0].opensOn',
          code: 'BEFORE_TODAY',
          message: 'This date cannot be in the past.',
        },
        {
          field: 'steps[0].requiresLoad',
          code: 'FIRST_STEP_LOAD',
          message: 'The first step must require a load.',
        },
        {
          field: 'steps[1].closesOn',
          code: 'CLOSES_BEFORE_OPENS',
          message: 'The closing date cannot be before the opening date.',
        },
      ]);
      // No text of the request (the long name) comes back anywhere.
      expect(res.text).not.toContain('xxxxxxxx');
    });

    it('a shape problem is a 400 on its own field before the rules run (the pipe, as everywhere)', async () => {
      const cycleId = await createCycle(2026);
      const before = nothingRan();

      const wrongType = await createTimeline(cycleId, { name: 5 });
      const missing = await w.send('post', `/cycles/${cycleId}/timelines`, {
        body: { name: 'July 2026' },
      });

      expectError(wrongType, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(wrongType)).toEqual([['name', 'INVALID_TYPE']]);
      expectError(missing, 400, 'VALIDATION_FAILED');
      // The two scope lists are optional at the pipe (design 7.2 step 1): an
      // absent list is a rule problem, reported with the others in one round.
      expect(fieldsOf(missing)).toEqual([
        ['allPrograms', 'REQUIRED'],
        ['allResultTypes', 'REQUIRED'],
        ['steps', 'REQUIRED'],
      ]);
      expect(nothingRan()).toEqual(before);
    });

    it('refuses a body that is not valid JSON with 400 MALFORMED_JSON', async () => {
      const cycleId = await createCycle(2026);

      const res = await w
        .send('post', `/cycles/${cycleId}/timelines`)
        .set('Content-Type', 'application/json')
        .send('{"name": ');

      expectError(res, 400, 'MALFORMED_JSON');
    });
  });

  // --- FR-12, FR-13, NFR-5: list and detail, read by date -----------------------

  describe('FR-12: GET /cycles/:id/timelines and GET /timelines/:id', () => {
    /** Moves the admin clock to this instant (UTC); a create happens before it, at the start of the world. */
    const at = (iso: string) =>
      w.adminClock.advance(
        new Date(iso).getTime() - w.adminClock.now().getTime(),
      );
    const listOf = (cycleId: number) =>
      w.send('get', `/cycles/${cycleId}/timelines`);
    const detailOf = (id: number) => w.send('get', `/timelines/${id}`);
    /** Every stored row and every write counter of the world, as one string: equal strings = nothing changed. */
    const stored = () =>
      JSON.stringify([
        rows(),
        w.world.cycles,
        w.world.assignments,
        w.world.timelineWriteLog,
        w.world.history,
        w.timelinesUnitOfWork.begun,
        w.timelinesUnitOfWork.committed,
        w.unitOfWork.begun,
        w.unitOfWork.committed,
      ]);

    const OFFICIAL_STEPS = [
      {
        name: 'QA Platform open for assessors',
        audience: 'assessors',
        opensOn: '2026-11-02',
        closesOn: '2026-11-03',
        round: 1,
        requiresLoad: true,
      },
      {
        name: 'QA open for Science Programs',
        audience: 'programs',
        opensOn: '2026-11-04',
        closesOn: '2026-11-05',
        round: 1,
        requiresLoad: false,
      },
      {
        name: 'QA open for Lead Assessors',
        audience: 'lead_assessors',
        opensOn: '2026-11-06',
        closesOn: '2026-11-09',
        round: 2,
        requiresLoad: true,
      },
      {
        name: 'Third-Party Broker review',
        audience: 'tpb',
        opensOn: '2026-11-10',
        closesOn: '2026-11-20',
        round: 2,
        requiresLoad: false,
      },
      {
        name: 'PPU review',
        audience: 'ppu',
        opensOn: '2026-11-23',
        closesOn: '2026-11-27',
        round: 2,
        requiresLoad: false,
      },
    ];
    const LATE_STEPS = [
      {
        name: 'QA Platform open for assessors',
        audience: 'assessors',
        opensOn: '2026-11-10',
        closesOn: '2026-11-20',
        round: 1,
        requiresLoad: true,
      },
      {
        name: 'QA open for Science Programs',
        audience: 'programs',
        opensOn: '2026-11-23',
        closesOn: '2026-11-27',
        round: 1,
        requiresLoad: false,
      },
    ];

    it('lists a timeline whole: name, kind, scope, steps with their dates, status, current step and readiness', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId);

      const res = await listOf(cycleId);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toEqual([
        {
          id: 1,
          cycleId,
          name: 'July 2026',
          kind: 'official',
          allPrograms: false,
          programIds: [2],
          allResultTypes: false,
          resultTypeKeys: ['INNOVATION_DEV'],
          steps: [
            { position: 1, ...STEP_1 },
            { position: 2, ...STEP_2 },
          ],
          status: 'scheduled',
          currentStep: null,
          nextStep: 1,
          readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
          assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
          createdAt: ISO,
        },
      ]);
    });

    it('a cycle without timelines is an empty list, not a 404', async () => {
      const cycleId = await createCycle(2026);

      const res = await listOf(cycleId);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('detail answers the same timeline as the list, plus its users, and a timeline of another cycle is not in the list', async () => {
      const cycleId = await createCycle(2026);
      const other = await createCycle(2027);
      const created = await createTimeline(cycleId);
      await createTimeline(other, { name: 'Elsewhere' });

      const list = await listOf(cycleId);
      const detail = await detailOf(created.body.data.id);

      expect(list.body.data.map((t: { name: string }) => t.name)).toEqual([
        'July 2026',
      ]);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toEqual({ ...list.body.data[0], users: [] });
    });

    // The three reads of the scenario, in order, over one timeline whose
    // step 1 closes on 6 Nov and step 2 opens on 9 Nov. Rome is UTC+1 in
    // November: 22:59Z is 23:59 on the 6th, 23:00Z is 00:00 on the 7th.
    it('steps open and close by date: 23:59 Rome on 6 Nov step 1, 00:00 on 7 Nov none (next 2), 00:00 on 9 Nov step 2, and reading writes nothing', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      const id = created.body.data.id as number;
      const before = stored();
      const writes = w.world.history.length;

      const seen: Array<{ status: string; current: unknown; next: unknown }> =
        [];
      for (const iso of [
        '2026-11-06T22:59:00.000Z',
        '2026-11-06T23:00:00.000Z',
        '2026-11-08T23:00:00.000Z',
      ]) {
        at(iso);
        const list = await listOf(cycleId);
        const detail = await detailOf(id);
        expect(list.status).toBe(200);
        expect(detail.status).toBe(200);
        // The list and the detail say the same thing at the same instant.
        expect(detail.body.data).toMatchObject({
          status: list.body.data[0].status,
          currentStep: list.body.data[0].currentStep,
          nextStep: list.body.data[0].nextStep,
        });
        seen.push({
          status: list.body.data[0].status,
          current: list.body.data[0].currentStep,
          next: list.body.data[0].nextStep,
        });
      }

      expect(seen).toEqual([
        { status: 'live', current: 1, next: 2 },
        { status: 'live', current: null, next: 2 },
        { status: 'live', current: 2, next: null },
      ]);
      // No stored state changed for any of this: no job, no hand.
      expect(w.world.history.length).toBe(writes);
      expect(stored()).toBe(before);
    });

    it.each([
      ['2026-11-01T22:59:00.000Z', 'scheduled', null, 1],
      ['2026-11-01T23:00:00.000Z', 'live', 1, 2],
      ['2026-11-13T22:59:00.000Z', 'live', 2, null],
      ['2026-11-13T23:00:00.000Z', 'finished', null, null],
    ])(
      'at %s (Rome) the timeline is %s, current step %s, next step %s',
      async (iso, status, current, next) => {
        const cycleId = await createCycle(2026);
        await createTimeline(cycleId);
        at(iso);

        const res = await listOf(cycleId);

        expect(res.body.data[0]).toMatchObject({
          status,
          currentStep: current,
          nextStep: next,
        });
      },
    );

    // Rome leaves summer time at 03:00 on 25 Oct 2026 (01:00Z): from then on
    // 22:30Z is 23:30 on the 25th and 23:30Z is 00:30 on the 26th.
    it('daylight-saving change: a step that closes on 25 Oct is still open at 23:30 Rome that night, and over at 00:30 Rome on the 26th', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId, {
        steps: [
          {
            ...STEP_1,
            opensOn: '2026-10-21',
            closesOn: '2026-10-25',
          },
          { ...STEP_2, opensOn: '2026-10-27', closesOn: '2026-10-30' },
        ],
      });

      at('2026-10-25T22:30:00.000Z');
      const night = await listOf(cycleId);
      at('2026-10-25T23:30:00.000Z');
      const after = await listOf(cycleId);

      expect(night.body.data[0]).toMatchObject({
        status: 'live',
        currentStep: 1,
        nextStep: 2,
      });
      expect(after.body.data[0]).toMatchObject({
        status: 'live',
        currentStep: null,
        nextStep: 2,
      });
    });

    it('two timelines are live at once, each with its own current step: the official one in step 4 and an additional one in step 1', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId, {
        name: 'Official',
        steps: OFFICIAL_STEPS,
      });
      await createTimeline(cycleId, { name: 'Additional', steps: LATE_STEPS });
      at('2026-11-16T10:00:00.000Z');

      const res = await listOf(cycleId);

      expect(res.status).toBe(200);
      expect(
        res.body.data.map(
          (t: {
            name: string;
            kind: string;
            status: string;
            currentStep: number;
            nextStep: number;
          }) => [t.name, t.kind, t.status, t.currentStep, t.nextStep],
        ),
      ).toEqual([
        ['Official', 'official', 'live', 4, 5],
        ['Additional', 'additional', 'live', 1, 2],
      ]);
    });

    it('puts the official timeline first and then the additional ones newest first, whatever the order they were made in', async () => {
      const cycleId = await createCycle(2026);
      const names = ['July 2026', 'August 2026', 'September 2026'];
      for (const name of names) {
        await createTimeline(cycleId, { name });
        // Each one is created later than the one before it.
        w.adminClock.advance(60 * 60 * 1000);
      }

      const res = await listOf(cycleId);

      expect(
        res.body.data.map((t: { name: string; kind: string }) => [
          t.name,
          t.kind,
        ]),
      ).toEqual([
        ['July 2026', 'official'],
        ['September 2026', 'additional'],
        ['August 2026', 'additional'],
      ]);
    });

    it('unknown cycle: 404 CYCLES_NOT_FOUND; unknown timeline: 404 TIMELINES_NOT_FOUND; an id that is not a number: 400 on `id`', async () => {
      await createCycle(2026);
      const before = stored();

      const noCycle = await listOf(99);
      const noTimeline = await detailOf(99);
      const badCycle = await w.send('get', '/cycles/abc/timelines');
      const badTimeline = await w.send('get', '/timelines/abc');

      expectError(noCycle, 404, 'CYCLES_NOT_FOUND');
      expectError(noTimeline, 404, 'TIMELINES_NOT_FOUND');
      expectError(badCycle, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(badCycle)).toEqual([['id', 'INVALID_TYPE']]);
      expectError(badTimeline, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(badTimeline)).toEqual([['id', 'INVALID_TYPE']]);
      expect(stored()).toBe(before);
    });
  });

  // --- FR-13: readiness ---------------------------------------------------------

  describe('FR-13: readiness in the list and the detail', () => {
    const listOf = (cycleId: number) =>
      w.send('get', `/cycles/${cycleId}/timelines`);

    it('a timeline with steps for Assessors and Science Programs and nobody assigned lists NO_RESULTS_LOADED and NO_ASSESSOR_ASSIGNED, and no Science Programs item; it is created, listed and dated as usual', async () => {
      const cycleId = await createCycle(2026);

      const created = await createTimeline(cycleId);
      const list = await listOf(cycleId);
      const detail = await w.send('get', `/timelines/${created.body.data.id}`);

      expect(created.status).toBe(201);
      for (const read of [list.body.data[0], detail.body.data]) {
        expect(read.readiness).toEqual([
          'NO_RESULTS_LOADED',
          'NO_ASSESSOR_ASSIGNED',
        ]);
        expect(read).toMatchObject({
          status: 'scheduled',
          nextStep: 1,
        });
      }
    });

    it('an active assignment of the role takes its item away and is counted; a removed one is neither', async () => {
      const cycleId = await createCycle(2026);
      const first = await createTimeline(cycleId);
      const second = await createTimeline(cycleId, { name: 'Second' });
      const [a, b] = [first.body.data.id, second.body.data.id] as number[];
      // `roles.id` 3 is ASSESSOR, 2 is LEAD_ASSESSOR. No route assigns users yet.
      w.world.assignments.push(
        ...[
          { timelineId: a, roleId: 3, removed: false },
          { timelineId: a, roleId: 3, removed: false },
          { timelineId: a, roleId: 2, removed: true },
          { timelineId: b, roleId: 3, removed: true },
        ].map((row, index) => ({
          id: index + 1,
          timelineId: row.timelineId,
          userId: w.admin.id,
          roleId: row.roleId,
          assignedAt: new Date(ISO),
          assignedBy: w.admin.id,
          removedAt: row.removed ? new Date(ISO) : null,
          removedBy: row.removed ? w.admin.id : null,
          activeKey: row.removed
            ? null
            : `${row.timelineId}:${index}:${row.roleId}`,
        })),
      );

      const list = await listOf(cycleId);

      const byId = new Map<number, any>(
        list.body.data.map((t: { id: number }) => [t.id, t]),
      );
      expect(byId.get(a)).toMatchObject({
        readiness: ['NO_RESULTS_LOADED'],
        assignedCount: { ASSESSOR: 2, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
      });
      expect(byId.get(b)).toMatchObject({
        readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
        assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
      });
    });
  });

  // --- NFR-5: a fixed number of statements -------------------------------------

  describe('NFR-5: the number of read statements does not depend on the number of timelines', () => {
    it('the list and the detail run as many statements over 50 timelines with 200 assignments as over one', async () => {
      const cycleId = await createCycle(2026);
      const first = await createTimeline(cycleId, { name: 'Timeline 1' });
      const firstId = first.body.data.id as number;
      const statementsOf = async (path: string) => {
        const from = w.world.timelineReadLog.length;
        const res = await w.send('get', path);
        expect(res.status).toBe(200);
        return w.world.timelineReadLog.slice(from);
      };
      const listOne = await statementsOf(`/cycles/${cycleId}/timelines`);
      const detailOne = await statementsOf(`/timelines/${firstId}`);

      for (let n = 2; n <= 50; n++) {
        const res = await createTimeline(cycleId, { name: `Timeline ${n}` });
        expect(res.status).toBe(201);
      }
      expect(w.world.timelines).toHaveLength(50);
      for (let n = 0; n < 200; n++) {
        const id = w.world.assignments.length + 1;
        const timelineId = (n % 50) + 1;
        w.world.assignments.push({
          id,
          timelineId,
          userId: w.admin.id,
          roleId: 3,
          assignedAt: new Date(ISO),
          assignedBy: w.admin.id,
          removedAt: null,
          removedBy: null,
          activeKey: `${timelineId}:${id}:3`,
        });
      }
      const listMany = await statementsOf(`/cycles/${cycleId}/timelines`);
      const detailMany = await statementsOf(`/timelines/${firstId}`);

      expect(listOne.length).toBeGreaterThan(0);
      expect(listMany).toHaveLength(listOne.length);
      expect(detailMany).toHaveLength(detailOne.length);
      // One statement per table: the steps of all 50 come in a single one.
      expect(listMany.filter((s) => s.startsWith('steps:'))).toHaveLength(1);
      expect(
        listMany.find((s) => s.startsWith('steps:'))?.split(',').length,
      ).toBe(50);
    });
  });

  // --- FR-17: safe retries -------------------------------------------------------

  describe('FR-17: Idempotency-Key on POST /cycles/:id/timelines', () => {
    it('a replay of an official create, after another timeline exists, returns the same official answer and creates nothing', async () => {
      const cycleId = await createCycle(2026);
      const first = await createTimeline(cycleId, {}, { key: 'create-july' });
      // Another timeline is created between the two calls: only then can a
      // replay be told from a new official create.
      const other = await createTimeline(cycleId, { name: 'August 2026' });
      const committed = w.timelinesUnitOfWork.committed;

      const replay = await createTimeline(cycleId, {}, { key: 'create-july' });

      expect(first.status).toBe(201);
      expect(first.body.data.kind).toBe('official');
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(other.body.data.kind).toBe('additional');
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(first.body.data);
      expect(replay.body.data.kind).toBe('official');
      expect(w.world.timelines).toHaveLength(2);
      expect(w.timelinesUnitOfWork.committed).toBe(committed);
    });

    it('a replayed refusal is the same refusal, marked as a replay', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId);

      const first = await createTimeline(cycleId, {}, { key: 'dup-july' });
      const replay = await createTimeline(cycleId, {}, { key: 'dup-july' });

      expectError(first, 409, 'TIMELINES_NAME_TAKEN');
      expectError(replay, 409, 'TIMELINES_NAME_TAKEN');
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(w.world.timelines).toHaveLength(1);
    });

    it('the same key with another body is 422 IDEMPOTENCY_KEY_REUSED and creates nothing', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId, {}, { key: 'k-1' });

      const res = await createTimeline(
        cycleId,
        { name: 'Another name' },
        { key: 'k-1' },
      );

      expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
      expect(w.world.timelines.map((t) => t.name)).toEqual(['July 2026']);
    });

    it('without a key the route is untouched: no replay header, and the repeat is the plain 409', async () => {
      const cycleId = await createCycle(2026);
      await createTimeline(cycleId);

      const second = await createTimeline(cycleId);

      expectError(second, 409, 'TIMELINES_NAME_TAKEN');
      expect(second.headers['idempotency-replayed']).toBeUndefined();
      expect(w.db.idempotency).toHaveLength(0);
    });

    it('a key left executed without an answer (the crash window) replays a fresh Timeline whose kind is the stored one', async () => {
      const cycleId = await createCycle(2026);
      const first = await createTimeline(cycleId, {}, { key: 'crash-1' });
      const id = first.body.data.id as number;
      await createTimeline(cycleId, { name: 'August 2026' });
      // The process died after the commit and before the answer was stored.
      const row = w.idempotency.peek(w.admin.id, 'crash-1')!;
      w.idempotency.seed({
        ...row,
        state: 'executed',
        responseStatus: null,
        responseBody: null,
      });

      const replay = await createTimeline(cycleId, {}, { key: 'crash-1' });

      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toMatchObject({
        id,
        name: 'July 2026',
        kind: 'official',
      });
      expect(w.world.timelines).toHaveLength(2);
    });
  });

  // --- NFR-7: one decision line per write, no names or bodies ------------------

  describe('NFR-7: the decision line', () => {
    it('every create logs exactly one line with ids and fixed words, and no name or body reaches any log', async () => {
      const cycleId = await createCycle(2026);
      // The catalog service keeps a copy of what it read: fail the source BEFORE
      // the first read, then restore it.
      w.catalogs.programsDown = true;
      const down = await createTimeline(cycleId, { name: 'Another Aug' });
      w.catalogs.programsDown = false;
      const created = await createTimeline(cycleId, {
        name: 'Confidential July',
      });
      const duplicate = await createTimeline(cycleId, {
        name: 'confidential july',
      });
      const invalid = await createTimeline(cycleId, { name: '' });

      const lineOf = (res: request.Response) =>
        spy
          .eventsOf('admin_config', res.headers['x-request-id'] as string)
          .filter((line) => line.action === 'timeline_create');
      const base = {
        event: 'admin_config',
        action: 'timeline_create',
        actorId: w.admin.id,
        idempotency: 'none',
      };
      expect(lineOf(created)).toEqual([
        {
          ...base,
          targetId: created.body.data.id,
          outcome: 'ok',
          requestId: created.headers['x-request-id'],
        },
      ]);
      expect(lineOf(duplicate)).toMatchObject([
        {
          ...base,
          targetId: null,
          outcome: 'refused',
          reason: 'TIMELINES_NAME_TAKEN',
        },
      ]);
      expect(lineOf(invalid)).toMatchObject([
        { outcome: 'refused', reason: 'VALIDATION_FAILED' },
      ]);
      expect(lineOf(down)).toMatchObject([
        { outcome: 'error', reason: 'SERVICE_UNAVAILABLE' },
      ]);
      expect(
        spy.lines.filter((l) =>
          /confidential|Another Aug|INNOVATION_DEV/i.test(l),
        ),
      ).toEqual([]);
    });
  });

  // --- OpenAPI ----------------------------------------------------------------

  describe('OpenAPI', () => {
    it('documents the list and the detail: no key header, the codes each can answer, the array of Timeline and the TimelineDetail with its users', () => {
      const doc = buildOpenApiDocument(w.app);
      const paths = doc.paths as Record<string, Record<string, any>>;
      const list = paths['/api/v1/cycles/{id}/timelines']!.get;
      const detail = paths['/api/v1/timelines/{id}']!.get;

      for (const [operation, codes] of [
        [list, ['200', '401', '403', '404']],
        [detail, ['200', '401', '403', '404']],
      ] as const) {
        expect(operation.summary).toBeTruthy();
        expect(Object.keys(operation.responses)).toEqual(
          expect.arrayContaining([...codes]),
        );
        expect(Object.keys(operation.responses)).not.toContain('422');
        expect(
          operation.parameters.map((p: { name: string }) => p.name),
        ).toEqual(['id']);
      }
      const dataOf = (operation: any) =>
        operation.responses['200'].content['application/json'].schema;
      expect(JSON.stringify(dataOf(list))).toContain(
        '#/components/schemas/TimelineModel',
      );
      expect(JSON.stringify(dataOf(detail))).toContain(
        '#/components/schemas/TimelineDetailModel',
      );
      const schemas = doc.components?.schemas as Record<string, any>;
      expect(schemas.TimelineDetailModel.required).toEqual(
        expect.arrayContaining(['users', 'status', 'currentStep', 'readiness']),
      );
      expect(Object.keys(schemas.TimelineUserModel.properties)).toEqual([
        'assignmentId',
        'userId',
        'firstName',
        'lastName',
        'email',
        'role',
        'assignedAt',
      ]);
    });

    it('documents the create and the defaults routes: the key header on create only, the codes each can answer, the Timeline model, no `kind` in the body', () => {
      const doc = buildOpenApiDocument(w.app);
      const paths = doc.paths as Record<string, Record<string, any>>;
      const create = paths['/api/v1/cycles/{id}/timelines']!.post;
      const defaults = paths['/api/v1/timeline-defaults']!.get;

      expect(create.summary).toBeTruthy();
      expect(Object.keys(create.responses)).toEqual(
        expect.arrayContaining([
          '201',
          '400',
          '401',
          '403',
          '404',
          '409',
          '422',
          '503',
        ]),
      );
      expect(create.parameters.map((p: { name: string }) => p.name)).toEqual(
        expect.arrayContaining(['id', 'Idempotency-Key']),
      );
      expect(
        create.responses['201'].headers['Idempotency-Replayed'],
      ).toBeDefined();
      expect(defaults.summary).toBeTruthy();
      expect(Object.keys(defaults.responses)).toEqual(
        expect.arrayContaining(['200', '401', '403']),
      );
      expect(
        (defaults.parameters ?? []).map((p: { name: string }) => p.name),
      ).not.toContain('Idempotency-Key');
      const schemas = doc.components?.schemas as Record<string, any>;
      expect(schemas.TimelineModel.required).toEqual(
        expect.arrayContaining([
          'id',
          'cycleId',
          'name',
          'kind',
          'allPrograms',
          'programIds',
          'allResultTypes',
          'resultTypeKeys',
          'steps',
          'status',
          'currentStep',
          'nextStep',
          'readiness',
          'assignedCount',
          'createdAt',
        ]),
      );
      expect(
        Object.keys(schemas.CreateTimelineDto.properties).sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ).toEqual([
        'allPrograms',
        'allResultTypes',
        'name',
        'programIds',
        'resultTypeKeys',
        'steps',
      ]);
      expect(schemas.DefaultStepModel.required).toEqual(
        expect.arrayContaining([
          'position',
          'name',
          'audience',
          'round',
          'requiresLoad',
        ]),
      );
    });
  });
});
