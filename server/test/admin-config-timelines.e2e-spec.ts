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

// Timelines over the real app (cycle-timelines T-6, the defaults and the
// create): FR-4 (defaults), FR-5 (official or additional, two at once, closed
// or unknown cycle, kind sent), FR-6 (name, scope, catalog down), FR-11 (every
// problem at once), FR-16 (admin only), FR-17 (safe retries), NFR-1, NFR-2,
// NFR-3, NFR-7. The guards, the pipe, the filter, the idempotency interceptor
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

describe('Timelines routes: defaults and create (e2e)', () => {
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
    type Route = ['defaults' | 'create', 'get' | 'post', string, object?];
    const ROUTES: Route[] = [
      ['defaults', 'get', '/timeline-defaults'],
      ['create', 'post', '/cycles/1/timelines', body()],
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

      expect([defaults.status, created.status]).toEqual([200, 201]);
    });

    it('declares ADMIN_ACCESS on each of its 2 routes and none as public', () => {
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
          route: 'GET timeline-defaults',
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
    it('documents the two routes: the key header on create only, the codes each can answer, the Timeline model, no `kind` in the body', () => {
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
