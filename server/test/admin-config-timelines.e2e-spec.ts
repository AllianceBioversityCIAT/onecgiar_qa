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

// Timelines over the real app (cycle-timelines T-6, T-7 and T-8: the defaults,
// the create, the list, the detail, and assigning and removing users): FR-4 (defaults), FR-5 (official or
// additional, two at once, closed or unknown cycle, kind sent), FR-6 (name,
// scope, catalog down), FR-11 (every problem at once), FR-12 (list and detail
// by date, with the clock overridden), FR-13 (readiness), FR-14 (assign), FR-15
// (remove), FR-16 (admin only),
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
      w.world.assignments,
    ]);
  /** `users.id` of a seeded actor, by the sub it signs in with. */
  const userIdOf = (sub: string) =>
    w.db.users.find((u) => u.cognitoSub === sub)!.id;
  const assign = (
    timelineId: number,
    userId: unknown,
    role: unknown,
    options: { token?: string | null } = {},
  ) =>
    w.send('post', `/timelines/${timelineId}/users`, {
      body: { userId, role },
      ...options,
    });
  const unassign = (
    timelineId: number | string,
    assignmentId: number | string,
  ) => w.send('delete', `/timelines/${timelineId}/users/${assignmentId}`);
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
      'defaults' | 'create' | 'list' | 'detail' | 'assign' | 'remove',
      'get' | 'post' | 'delete',
      string,
      object?,
    ];
    const ROUTES: Route[] = [
      ['defaults', 'get', '/timeline-defaults'],
      ['create', 'post', '/cycles/1/timelines', body()],
      ['list', 'get', '/cycles/1/timelines'],
      ['detail', 'get', '/timelines/1'],
      ['assign', 'post', '/timelines/1/users', { userId: 1, role: 'ASSESSOR' }],
      ['remove', 'delete', '/timelines/1/users/1'],
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
      const assigned = await assign(
        created.body.data.id,
        userIdOf('sub-multi_grant'),
        'ASSESSOR',
      );
      const removed = await unassign(
        created.body.data.id,
        assigned.body.data.assignmentId,
      );

      expect([
        defaults.status,
        created.status,
        list.status,
        detail.status,
        assigned.status,
        removed.status,
      ]).toEqual([200, 201, 200, 200, 201, 204]);
    });

    it('declares ADMIN_ACCESS on each of its 7 routes and none as public', () => {
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
          route: 'DELETE timelines/:id/users/:assignmentId',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
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
          route: 'PATCH timelines/:id',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
        {
          route: 'POST cycles/:id/timelines',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
        {
          route: 'POST timelines/:id/users',
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
          { position: 1, ...STEP_1, state: 'upcoming' },
          { position: 2, ...STEP_2, state: 'upcoming' },
        ],
        status: 'scheduled',
        currentStep: null,
        nextStep: 1,
        readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
        assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
        createdAt: ISO,
        version: 1,
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
      expect(rows()).toBe(JSON.stringify([[], [], [], [], []]));
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
    /**
     * The tests that expect `live` or `finished` read a timeline that HAS a
     * load (timeline-edit DD-8): without one it is `waiting_for_load` from its
     * step 1 day on. The fake loads port is the only thing that says so.
     */
    const withLoads = () =>
      w.world.loads.markLoaded(...w.world.timelines.map((t) => t.id));
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
            { position: 1, ...STEP_1, state: 'upcoming' },
            { position: 2, ...STEP_2, state: 'upcoming' },
          ],
          status: 'scheduled',
          currentStep: null,
          nextStep: 1,
          readiness: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
          assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
          createdAt: ISO,
          version: 1,
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
      withLoads();
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
        withLoads();
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
      withLoads();

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
      withLoads();
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

  // --- timeline-edit FR-2, FR-6, FR-14: the hold and the new fields ----------------

  describe('timeline-edit FR-6, FR-2, FR-14: waiting for load, step state and version', () => {
    const at = (iso: string) =>
      w.adminClock.advance(
        new Date(iso).getTime() - w.adminClock.now().getTime(),
      );
    const listOf = (cycleId: number) =>
      w.send('get', `/cycles/${cycleId}/timelines`);
    const detailOf = (id: number) => w.send('get', `/timelines/${id}`);
    const stored = () =>
      JSON.stringify([
        rows(),
        w.world.cycles,
        w.world.assignments,
        w.world.timelineWriteLog,
        w.world.history,
      ]);
    // Rome is UTC+1 in November: 23:00Z on 1 Nov is 00:00 Rome on 2 Nov, step 1's opening day.
    const STEP_1_DAY = '2026-11-01T23:00:00.000Z';

    it('step 1 date arrives without a load: the list and the detail say waiting_for_load, no current step, next step 1, every step upcoming, and reading writes nothing', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      const id = created.body.data.id as number;
      at(STEP_1_DAY);
      const before = stored();

      const list = await listOf(cycleId);
      const detail = await detailOf(id);

      for (const read of [list.body.data[0], detail.body.data]) {
        expect(read).toMatchObject({
          status: 'waiting_for_load',
          currentStep: null,
          nextStep: 1,
        });
        expect(read.status).not.toBe('live');
        expect(read.steps.map((step: { state: string }) => step.state)).toEqual(
          ['upcoming', 'upcoming'],
        );
      }
      expect(stored()).toBe(before);
    });

    it('one minute earlier the timeline is still scheduled, with or without a load', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      const id = created.body.data.id as number;
      at('2026-11-01T22:59:00.000Z'); // 23:59 Rome on 1 Nov

      const without = await detailOf(id);
      w.world.loads.markLoaded(id);
      const withLoad = await detailOf(id);

      for (const read of [without.body.data, withLoad.body.data]) {
        expect(read).toMatchObject({
          status: 'scheduled',
          currentStep: null,
          nextStep: 1,
        });
      }
    });

    it('all dates passed without a load: still waiting_for_load, not finished', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      at('2027-01-15T10:00:00.000Z');

      const detail = await detailOf(created.body.data.id);

      expect(detail.body.data).toMatchObject({
        status: 'waiting_for_load',
        currentStep: null,
        nextStep: 1,
      });
      expect(
        detail.body.data.steps.map((step: { state: string }) => step.state),
      ).toEqual(['upcoming', 'upcoming']);
    });

    it('a load present gives the delivered behavior: live, current step 1, step 1 in progress and step 2 upcoming; after the last day, finished with both closed', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      const id = created.body.data.id as number;
      w.world.loads.markLoaded(id);

      at(STEP_1_DAY);
      const running = await detailOf(id);
      at('2026-11-13T23:00:00.000Z'); // 00:00 Rome on 14 Nov, after step 2 closed
      const over = await detailOf(id);

      expect(running.body.data).toMatchObject({
        status: 'live',
        currentStep: 1,
        nextStep: 2,
      });
      expect(
        running.body.data.steps.map((step: { state: string }) => step.state),
      ).toEqual(['in_progress', 'upcoming']);
      expect(over.body.data).toMatchObject({
        status: 'finished',
        currentStep: null,
        nextStep: null,
      });
      expect(
        over.body.data.steps.map((step: { state: string }) => step.state),
      ).toEqual(['closed', 'closed']);
    });

    it('in one list only the timeline without a load is on hold', async () => {
      const cycleId = await createCycle(2026);
      const held = await createTimeline(cycleId, { name: 'Held' });
      const loaded = await createTimeline(cycleId, { name: 'Loaded' });
      w.world.loads.markLoaded(loaded.body.data.id);
      at(STEP_1_DAY);

      const list = await listOf(cycleId);

      expect(
        list.body.data.map((t: { id: number; status: string }) => [
          t.id,
          t.status,
        ]),
      ).toEqual([
        [held.body.data.id, 'waiting_for_load'],
        [loaded.body.data.id, 'live'],
      ]);
    });

    it('the detail keeps every field the list returns and adds the users; each step has its state and the timeline its version', async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);

      const detail = await detailOf(created.body.data.id);

      // Written out: the FR-12 fields of the delivered spec, plus `version`.
      expect(Object.keys(detail.body.data).sort()).toEqual(
        [
          'allPrograms',
          'allResultTypes',
          'assignedCount',
          'createdAt',
          'currentStep',
          'cycleId',
          'id',
          'kind',
          'name',
          'nextStep',
          'programIds',
          'readiness',
          'resultTypeKeys',
          'status',
          'steps',
          'users',
          'version',
        ].sort(),
      );
      expect(Object.keys(detail.body.data.steps[0]).sort()).toEqual(
        [
          'audience',
          'closesOn',
          'name',
          'opensOn',
          'position',
          'requiresLoad',
          'round',
          'state',
        ].sort(),
      );
      expect(detail.body.data.version).toBe(1);
      expect(detail.body.data.steps[0].state).toBe('upcoming');
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
      // Two ASSESSORs stay on `a`; a LEAD_ASSESSOR on `a` and an ASSESSOR on `b` are assigned, then removed.
      const kept = [
        await assign(a, userIdOf('sub-assessor'), 'ASSESSOR'),
        await assign(a, userIdOf('sub-multi_grant'), 'ASSESSOR'),
      ];
      const lead = await assign(
        a,
        userIdOf('sub-lead_assessor'),
        'LEAD_ASSESSOR',
      );
      const gone = await assign(b, userIdOf('sub-assessor'), 'ASSESSOR');
      expect([...kept, lead, gone].map((res) => res.status)).toEqual([
        201, 201, 201, 201,
      ]);
      expect((await unassign(a, lead.body.data.assignmentId)).status).toBe(204);
      expect((await unassign(b, gone.body.data.assignmentId)).status).toBe(204);

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
      // Four assignments on each of the 50 timelines, through the route.
      const staff: Array<[string, string]> = [
        ['sub-assessor', 'ASSESSOR'],
        ['sub-multi_grant', 'ASSESSOR'],
        ['sub-multi_grant', 'TPB'],
        ['sub-lead_assessor', 'LEAD_ASSESSOR'],
      ];
      for (let timelineId = 1; timelineId <= 50; timelineId++) {
        for (const [sub, role] of staff) {
          const res = await assign(timelineId, userIdOf(sub), role);
          expect(res.status).toBe(201);
        }
      }
      expect(w.world.assignments).toHaveLength(200);
      const listMany = await statementsOf(`/cycles/${cycleId}/timelines`);
      const detailMany = await statementsOf(`/timelines/${firstId}`);

      expect(listOne.length).toBeGreaterThan(0);
      expect(listMany).toHaveLength(listOne.length);
      expect(detailMany).toHaveLength(detailOne.length);
      // The app binds the fake loads port, which is a statement of its own:
      // the count includes it (cycle, timelines, steps, programs, result types,
      // assignment counts, loads), and it asked for the 50 ids in one call.
      expect(listMany).toHaveLength(7);
      expect(listMany.filter((s) => s.startsWith('loads:'))).toHaveLength(1);
      expect(
        listMany.find((s) => s.startsWith('loads:'))?.split(',').length,
      ).toBe(50);
      expect(detailMany.filter((s) => s.startsWith('loads:'))).toHaveLength(1);
      // The users of the detail come in one statement, however many there are.
      expect(detailMany.filter((q) => q.startsWith('users:'))).toHaveLength(1);
      const detailBody = await w.send('get', `/timelines/${firstId}`);
      expect(detailBody.body.data.users).toHaveLength(4);
      // One statement per table: the steps of all 50 come in a single one.
      expect(listMany.filter((s) => s.startsWith('steps:'))).toHaveLength(1);
      expect(
        listMany.find((s) => s.startsWith('steps:'))?.split(',').length,
      ).toBe(50);
    }, 30_000); // 50 timelines with 200 assignments: slower than the 5 s default on the CI machine
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

  // --- timeline-edit: PATCH /timelines/:id --------------------------------------

  describe('timeline-edit: PATCH /timelines/:id', () => {
    /** Moves the admin clock to this instant (UTC). Rome is UTC+1 in November. The clock only moves forward: call `at` with non-decreasing instants within a case. */
    const at = (iso: string) =>
      w.adminClock.advance(
        new Date(iso).getTime() - w.adminClock.now().getTime(),
      );
    const patch = (
      id: number | string,
      payload: object,
      options: { token?: string | null; key?: string } = {},
    ) => {
      const call = request(w.app.getHttpServer()).patch(
        `/api/v1/timelines/${id}`,
      );
      const token =
        options.token === undefined ? bearer('sub-admin') : options.token;
      if (token !== null) call.set('Authorization', token);
      if (options.key !== undefined) call.set('Idempotency-Key', options.key);
      return call.send(payload);
    };
    const detailOf = (id: number) => w.send('get', `/timelines/${id}`);
    /** Every stored row, audit row, write counter and committed transaction, as one string: equal strings = nothing changed (a refused write may begin and roll back). */
    const stored = () =>
      JSON.stringify([
        rows(),
        w.world.cycles,
        w.world.assignments,
        w.world.auditEvents,
        w.world.timelineWriteLog,
        w.world.history,
        w.timelinesUnitOfWork.committed,
      ]);
    type Tables = Array<Array<Record<string, unknown>>>;
    /** The stored rows as plain data: the timelines, then the steps, programs, result types and assignments. */
    const tablesNow = () => JSON.parse(rows()) as Tables;
    /** A timeline of cycle 2026: step 1 2 to 6 Nov, step 2 9 to 13 Nov; version 1. */
    const setup = async (over: Record<string, unknown> = {}) => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId, over);
      expect(created.status).toBe(201);
      return { cycleId, id: created.body.data.id as number };
    };
    /** What a refusal must leave as it found it: the timeline read whole, and every stored row, audit row, write counter and committed transaction as one string. */
    const snapshot = async (id: number) => ({
      read: (await detailOf(id)).body.data,
      state: stored(),
    });
    /** The timeline read again is, whole, the one in `before`, and the stored state is the same string (reading writes nothing, so this can run after each refusal of a case). */
    const expectUnchanged = async (
      id: number,
      before: Awaited<ReturnType<typeof snapshot>>,
    ) => {
      expect((await detailOf(id)).body.data).toEqual(before.read);
      expect(stored()).toBe(before.state);
    };
    /**
     * A refusal: the answer, then the timeline read again is, whole, the one
     * read before, and no row, audit row or write counter moved.
     *
     * It also asserts that there are 0 audit rows in the whole world, so it
     * only fits before any applied edit in a case; after an applied edit, take
     * a `snapshot` and call `expectUnchanged` instead.
     */
    const refused = async (
      id: number,
      payload: object,
      status: number,
      code: string,
      options: { token?: string | null; key?: string } = {},
    ) => {
      const before = await snapshot(id);
      const res = await patch(id, payload, options);
      expectError(res, status, code);
      await expectUnchanged(id, before);
      expect(w.world.auditEvents).toHaveLength(0);
      return res;
    };
    /** The PATCH answer is the Timeline as the list reads it: the detail read without its `users`. */
    const withoutUsers = (read: { users?: unknown }) => {
      const { users: _users, ...rest } = read;
      return rest;
    };
    const byField = (a: string[], b: string[]) => a[0].localeCompare(b[0]);
    const stepStatesOf = (res: request.Response) =>
      (res.body.data.steps as Array<{ state: string }>).map((s) => s.state);

    describe('FR-12, NFR-1: access', () => {
      it('has a 403 row for every grantable role (a new role without one fails here)', () => {
        const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
        for (const { code } of GRANTABLE_ROLES) {
          expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
        }
      });

      it('no token and a token that is not valid are 401 AUTH_TOKEN_INVALID before anything else', async () => {
        const { id } = await setup();
        const unchanged = await snapshot(id);

        for (const token of [null, 'Bearer not-a-token']) {
          const before = nothingRan();

          const res = await patch(
            id,
            { version: 1, name: 'Hijack' },
            { token },
          );

          expectError(res, 401, 'AUTH_TOKEN_INVALID');
          expect(nothingRan()).toEqual(before);
          await expectUnchanged(id, unchanged);
        }
      });

      it.each(NON_ADMINS)(
        '%s gets 403 AUTH_PERMISSION_DENIED, with nothing read or written and the timeline unchanged',
        async (role) => {
          const { id } = await setup();
          const readBefore = await detailOf(id);
          const before = nothingRan();
          const stateBefore = stored();
          const catalogCalls = { ...w.catalogs };

          const res = await patch(
            id,
            { version: 1, name: 'Hijack' },
            { token: bearer(`sub-${role.toLowerCase()}`) },
          );

          expectError(res, 403, 'AUTH_PERMISSION_DENIED');
          expect(nothingRan()).toEqual(before);
          expect(stored()).toBe(stateBefore);
          expect(w.catalogs).toEqual(catalogCalls);
          expect((await detailOf(id)).body.data).toEqual(readBefore.body.data);
        },
      );

      it('an unknown timeline is 404 TIMELINES_NOT_FOUND; an id that is not a number is 400 on `id`; neither writes', async () => {
        const { id } = await setup();
        const unchanged = await snapshot(id);

        const missing = await patch(999, { version: 1, name: 'X' });
        expectError(missing, 404, 'TIMELINES_NOT_FOUND');
        await expectUnchanged(id, unchanged);

        const notNumber = await patch('abc', { version: 1, name: 'X' });
        expectError(notNumber, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(notNumber)[0]![0]).toBe('id');
        await expectUnchanged(id, unchanged);
      });

      it('a timeline in a closed cycle is 409 CYCLES_CLOSED, and it is read again unchanged', async () => {
        const closed = await createCycle(2026);
        await activateCycle(closed);
        const created = await createTimeline(closed);
        const id = created.body.data.id as number;
        await activateCycle(await createCycle(2027));

        const res = await refused(
          id,
          { version: 1, name: 'Late rename' },
          409,
          'CYCLES_CLOSED',
        );

        expect(res.body.error.fields).toBeUndefined();
      });

      it('a malformed JSON body is 400 MALFORMED_JSON and writes nothing', async () => {
        const { id } = await setup();
        const before = stored();
        const readBefore = await detailOf(id);

        const res = await request(w.app.getHttpServer())
          .patch(`/api/v1/timelines/${id}`)
          .set('Authorization', bearer('sub-admin'))
          .set('Content-Type', 'application/json')
          .send('{"version": 1,');

        expectError(res, 400, 'MALFORMED_JSON');
        expect(stored()).toBe(before);
        expect((await detailOf(id)).body.data).toEqual(readBefore.body.data);
      });
    });

    describe('FR-1, FR-14: the edit and its answer', () => {
      it('extends step 1 only: its closing date changes, every other field keeps its value, the version moves, and the answer is the timeline as a GET reads it', async () => {
        const { id } = await setup();
        const before = (await detailOf(id)).body.data;

        const res = await patch(id, {
          version: 1,
          steps: [{ position: 1, closesOn: '2026-11-07' }],
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const expected = structuredClone(before);
        expected.version = 2;
        expected.steps[0].closesOn = '2026-11-07';
        expect(res.body.data).toEqual(withoutUsers(expected));
        expect((await detailOf(id)).body.data).toEqual(expected);
        expect(w.world.auditEvents).toHaveLength(1);
      });

      it('a PATCH then a GET after the moved dates: with the step 1 day arrived and no load the timeline was waiting_for_load; moving step 1 to open later makes it scheduled', async () => {
        const { id } = await setup();
        at('2026-11-01T23:00:00.000Z'); // 00:00 Rome on 2 Nov
        const held = await detailOf(id);

        const res = await patch(id, {
          version: 1,
          steps: [{ position: 1, opensOn: '2026-11-03' }],
        });
        const read = await detailOf(id);

        expect(held.body.data).toMatchObject({
          status: 'waiting_for_load',
          nextStep: 1,
        });
        expect(res.status).toBe(200);
        for (const view of [res.body.data, read.body.data]) {
          expect(view).toMatchObject({
            status: 'scheduled',
            currentStep: null,
            nextStep: 1,
            version: 2,
          });
          expect(view.steps[0].opensOn).toBe('2026-11-03');
        }
        expect(stepStatesOf(read)).toEqual(['upcoming', 'upcoming']);
      });

      it('renames the timeline and a step; with `confirmInProgress` sent for nothing in progress, it is accepted and ignored', async () => {
        const { id } = await setup();

        const res = await patch(id, {
          version: 1,
          name: 'July 2026 (revised)',
          confirmInProgress: true,
          steps: [{ position: 2, name: 'Programs review' }],
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
          name: 'July 2026 (revised)',
          version: 2,
        });
        expect(res.body.data.steps[1].name).toBe('Programs review');
        expect(res.body.data.steps[0].name).toBe(STEP_1.name);
      });

      it('reading never moves the version: two GETs after an edit show the same version', async () => {
        const { id } = await setup();
        await patch(id, { version: 1, name: 'Renamed' });

        const first = await detailOf(id);
        const second = await detailOf(id);

        expect(first.body.data.version).toBe(2);
        expect(second.body.data.version).toBe(2);
      });
    });

    describe('FR-1, NFR-2: the structure is fixed', () => {
      it.each([
        ['audience', 'programs'],
        ['round', 2],
        ['requiresLoad', false],
        ['kind', 'official'],
      ])(
        'a top-level `%s` is 400 UNKNOWN_FIELD on that key and nothing is written',
        async (key, value) => {
          const { id } = await setup();

          const res = await refused(
            id,
            { version: 1, name: 'Changed', [key]: value },
            400,
            'VALIDATION_FAILED',
          );

          expect(res.body.error.fields).toEqual([
            {
              field: key,
              code: 'UNKNOWN_FIELD',
              message: 'This field is not allowed.',
            },
          ]);
        },
      );

      it.each([
        ['audience', 'programs'],
        ['round', 2],
        ['requiresLoad', false],
        ['kind', 'official'],
      ])(
        '`%s` inside a step is 400 UNKNOWN_FIELD on that key of `steps[0]` and nothing is written',
        async (key, value) => {
          const { id } = await setup();

          const res = await refused(
            id,
            { version: 1, steps: [{ position: 1, [key]: value }] },
            400,
            'VALIDATION_FAILED',
          );

          expect(fieldsOf(res)).toEqual([[`steps[0].${key}`, 'UNKNOWN_FIELD']]);
        },
      );

      it('a step without a position is 400 and nothing is written', async () => {
        const { id } = await setup();

        const res = await refused(
          id,
          { version: 1, steps: [{ name: 'No position' }] },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([
          ['steps[0].position', expect.any(String)],
        ]);
      });

      it('a position the timeline does not have, and the same position twice, are each refused naming that step, in one 400', async () => {
        const { id } = await setup();

        const res = await refused(
          id,
          {
            version: 1,
            steps: [
              { position: 3, name: 'A third step' },
              { position: 1, name: 'First' },
              { position: 1, name: 'First again' },
            ],
          },
          400,
          'VALIDATION_FAILED',
        );

        const paths = fieldsOf(res).map(([field]) => field);
        expect(paths).toContain('steps[0].position');
        expect(paths).toContain('steps[2].position');
        expect(paths).not.toContain('steps[1].position');
        expect((await detailOf(id)).body.data.steps).toHaveLength(2);
      });

      it('`programIds: null` passes the pipe and is read as no scope change: 200, version 1, the programs stay, and nothing is written (the rules decide, not the pipe)', async () => {
        const { id } = await setup();
        const before = stored();

        const res = await patch(id, { version: 1, programIds: null });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ programIds: [2], version: 1 });
        expect(stored()).toBe(before);
      });
    });

    describe('FR-3: date locks by step state', () => {
      it('a closed step: a new closing date is 400 LOCKED on that step, and a new name for it is accepted', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-07T10:00:00.000Z'); // step 1 closed, step 2 upcoming
        expect(stepStatesOf(await detailOf(id))).toEqual([
          'closed',
          'upcoming',
        ]);

        const locked = await refused(
          id,
          { version: 1, steps: [{ position: 1, closesOn: '2026-11-08' }] },
          400,
          'VALIDATION_FAILED',
        );
        const renamed = await patch(id, {
          version: 1,
          steps: [{ position: 1, name: 'Assessors (done)' }],
        });

        expect(locked.body.error.fields).toEqual([
          {
            field: 'steps[0].closesOn',
            code: 'LOCKED',
            message: 'This can no longer be changed.',
          },
        ]);
        expect(renamed.status).toBe(200);
        expect(renamed.body.data.steps[0].name).toBe('Assessors (done)');
        expect(renamed.body.data.steps[0].closesOn).toBe('2026-11-06');
      });

      it('an in-progress step: closing before today and moving the opening date are both refused in one 400; closing today is accepted', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-04T10:00:00.000Z'); // today in Rome is 4 Nov, step 1 in progress

        const res = await refused(
          id,
          {
            version: 1,
            confirmInProgress: true,
            steps: [
              { position: 1, opensOn: '2026-11-03', closesOn: '2026-11-03' },
            ],
          },
          400,
          'VALIDATION_FAILED',
        );
        const today = await patch(id, {
          version: 1,
          confirmInProgress: true,
          steps: [{ position: 1, closesOn: '2026-11-04' }],
        });

        expect(fieldsOf(res).sort(byField)).toEqual(
          [
            ['steps[0].closesOn', 'BEFORE_TODAY'],
            ['steps[0].opensOn', 'LOCKED'],
          ].sort(byField),
        );
        expect(today.status).toBe(200);
        expect(today.body.data.steps[0].closesOn).toBe('2026-11-04');
      });

      it('an upcoming step: opening yesterday is refused as before today; opening at the current minute is accepted and the step is in progress at once', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        // 00:00 Rome on 1 Nov: a day-only "today" means this very minute (S-6),
        // step 1 is upcoming (it opens on 2 Nov).
        at('2026-10-31T23:00:00.000Z');

        const res = await refused(
          id,
          { version: 1, steps: [{ position: 1, opensOn: '2026-10-31' }] },
          400,
          'VALIDATION_FAILED',
        );
        const today = await patch(id, {
          version: 1,
          steps: [{ position: 1, opensOn: '2026-11-01' }],
        });
        const read = await detailOf(id);

        expect(fieldsOf(res)).toEqual([['steps[0].opensOn', 'BEFORE_TODAY']]);
        expect(today.status).toBe(200);
        expect(stepStatesOf(read)).toEqual(['in_progress', 'upcoming']);
        expect(read.body.data).toMatchObject({
          status: 'live',
          currentStep: 1,
        });
      });

      it('an upcoming step: a day-only opening today is before now once the day has begun (10:00 Rome), so it is refused (S-4, FR-6)', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-01T09:00:00.000Z'); // 10:00 Rome on 1 Nov

        const res = await refused(
          id,
          { version: 1, steps: [{ position: 1, opensOn: '2026-11-01' }] },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([['steps[0].opensOn', 'BEFORE_TODAY']]);
      });

      it('on hold with step 1 opening day in the past: a rename sending that stored date succeeds, and the past date is not reported', async () => {
        const { id } = await setup();
        at('2026-11-03T10:00:00.000Z'); // step 1 day passed, no load: waiting_for_load
        expect((await detailOf(id)).body.data.status).toBe('waiting_for_load');

        const res = await patch(id, {
          version: 1,
          name: 'Renamed on hold',
          steps: [{ position: 1, opensOn: '2026-11-02' }],
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
          name: 'Renamed on hold',
          status: 'waiting_for_load',
        });
        expect(res.body.data.steps[0].opensOn).toBe('2026-11-02');
      });
    });

    describe('FR-4: scope lock', () => {
      it('before step 1 and with no load: programs SP02 to SP01 and SP02 are accepted and a GET shows them', async () => {
        const { id } = await setup();

        const res = await patch(id, {
          version: 1,
          allPrograms: false,
          programIds: [1, 2],
        });
        const read = await detailOf(id);

        expect(res.status).toBe(200);
        expect(read.body.data.programIds).toEqual([1, 2]);
        expect(read.body.data.resultTypeKeys).toEqual(['INNOVATION_DEV']);
        expect(read.body.data.version).toBe(2);
      });

      it('after step 1 started: a result types change is 400 LOCKED on `resultTypeKeys` and nothing is written', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-04T10:00:00.000Z');

        const res = await refused(
          id,
          { version: 1, allResultTypes: false, resultTypeKeys: ['KP'] },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([['resultTypeKeys', 'LOCKED']]);
      });

      it('with a load and step 1 still upcoming: a programs change is 400 LOCKED on `programIds`', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);

        const res = await refused(
          id,
          { version: 1, allPrograms: false, programIds: [1, 2] },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([['programIds', 'LOCKED']]);
      });

      it('a scope sent equal to the stored one is not a change, even after step 1 started', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-04T10:00:00.000Z');
        const before = stored();

        const res = await patch(id, {
          version: 1,
          allPrograms: false,
          programIds: [2],
        });

        expect(res.status).toBe(200);
        expect(res.body.data.version).toBe(1);
        expect(stored()).toBe(before);
      });
    });

    describe('FR-5: every creation rule still holds, every problem at once', () => {
      it('an overlap introduced by an edit is named on the step whose opening date overlaps, though only step 1 was sent', async () => {
        const { id } = await setup();

        const res = await refused(
          id,
          { version: 1, steps: [{ position: 1, closesOn: '2026-11-12' }] },
          400,
          'VALIDATION_FAILED',
        );

        expect(res.body.error.fields).toEqual([
          {
            field: 'steps[1].opensOn',
            code: 'OVERLAPS_PREVIOUS_STEP',
            message: 'This step must open after the previous step closes.',
          },
        ]);
      });

      it('a step closing before it opens, an empty name and a too long step name are all listed, with catalog codes and messages and no free text', async () => {
        const { id } = await setup();

        const res = await refused(
          id,
          {
            version: 1,
            name: '',
            steps: [
              { position: 2, name: 'x'.repeat(121), closesOn: '2026-11-08' },
            ],
          },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([
          ['name', 'REQUIRED'],
          ['steps[1].name', 'TOO_LONG'],
          ['steps[1].closesOn', 'CLOSES_BEFORE_OPENS'],
        ]);
        for (const field of res.body.error.fields as Array<{
          message: string;
        }>) {
          expect(field.message).toMatch(/^[A-Z][^]*\.$/);
          expect(field.message).not.toMatch(/sql|ER_|constraint|column/i);
        }
      });

      it('an empty name, a closed step date changed and a scope change after step 1 started are one 400 listing all three', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-07T10:00:00.000Z');

        const res = await refused(
          id,
          {
            version: 1,
            name: '',
            allPrograms: false,
            programIds: [1, 2],
            steps: [{ position: 1, closesOn: '2026-11-08' }],
          },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res).sort(byField)).toEqual(
          [
            ['name', 'REQUIRED'],
            ['steps[0].closesOn', 'LOCKED'],
            ['programIds', 'LOCKED'],
          ].sort(byField),
        );
        for (const field of res.body.error.fields as Array<{
          message: string;
        }>) {
          expect(field.message.length).toBeGreaterThan(0);
        }
      });

      it('a name equal to another timeline of the cycle in another letter case is 409 TIMELINES_NAME_TAKEN and nothing is written', async () => {
        const { cycleId, id } = await setup();
        await createTimeline(cycleId, { name: 'August 2026' });

        await refused(
          id,
          { version: 1, name: 'AUGUST 2026' },
          409,
          'TIMELINES_NAME_TAKEN',
        );
      });
    });

    describe('FR-7, FR-8: in-progress steps and their confirmation', () => {
      it('without confirmation an in-progress change is 409 TIMELINES_IN_PROGRESS_UNCONFIRMED and nothing is written; with it the change is saved', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-04T10:00:00.000Z');
        const change = {
          version: 1,
          steps: [{ position: 1, closesOn: '2026-11-07' }],
        };

        const res = await refused(
          id,
          change,
          409,
          'TIMELINES_IN_PROGRESS_UNCONFIRMED',
        );
        const confirmed = await patch(id, {
          ...change,
          confirmInProgress: true,
        });

        expect(res.body.error.fields).toBeUndefined();
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.data.steps[0].closesOn).toBe('2026-11-07');
        expect(confirmed.body.data.version).toBe(2);
      });

      it('a rule problem answers first: an unconfirmed in-progress change that also breaks a rule is the 400, not the 409', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-04T10:00:00.000Z');

        const res = await refused(
          id,
          {
            version: 1,
            name: '',
            steps: [{ position: 1, closesOn: '2026-11-07' }],
          },
          400,
          'VALIDATION_FAILED',
        );

        expect(fieldsOf(res)).toEqual([['name', 'REQUIRED']]);
      });

      it('extends an in-progress step that closes today, with confirmation: a later GET still shows it in progress past the old closing day, and the reads write nothing', async () => {
        const { id } = await setup();
        w.world.loads.markLoaded(id);
        at('2026-11-06T10:00:00.000Z'); // step 1 closes today
        expect(stepStatesOf(await detailOf(id))).toEqual([
          'in_progress',
          'upcoming',
        ]);

        const res = await patch(id, {
          version: 1,
          confirmInProgress: true,
          steps: [{ position: 1, closesOn: '2026-11-08' }],
        });
        at('2026-11-07T10:00:00.000Z'); // past the old closing day
        const writesBefore = [...w.world.timelineWriteLog];
        const read = await detailOf(id);
        const list = await w.send(
          'get',
          `/cycles/${(await detailOf(id)).body.data.cycleId}/timelines`,
        );

        expect(res.status).toBe(200);
        expect(stepStatesOf(read)).toEqual(['in_progress', 'upcoming']);
        expect(read.body.data).toMatchObject({
          status: 'live',
          currentStep: 1,
        });
        expect(list.body.data[0]).toMatchObject({
          status: 'live',
          currentStep: 1,
        });
        expect(w.world.timelineWriteLog).toEqual(writesBefore);
      });
    });

    describe('FR-9, NFR-3: stale edits', () => {
      it('a second edit made on the version both admins read is 409 TIMELINES_VERSION_STALE: the first edit stays, the second is not merged', async () => {
        const { id } = await setup();
        const before = (await detailOf(id)).body.data;
        const ana = await patch(id, { version: 1, name: 'Ana name' });
        const afterAna = await snapshot(id);

        const luis = await patch(
          id,
          {
            version: 1,
            name: 'Luis name',
            steps: [{ position: 2, name: 'Luis step' }],
          },
          { token: bearer('sub-admin2') },
        );

        expect(ana.status).toBe(200);
        const expected = structuredClone(before);
        expected.name = 'Ana name';
        expected.version = 2;
        expect(ana.body.data).toEqual(withoutUsers(expected));
        expect(afterAna.read).toEqual(expected);
        expectError(luis, 409, 'TIMELINES_VERSION_STALE');
        await expectUnchanged(id, afterAna);
        expect(w.world.auditEvents).toHaveLength(1);
      });

      it('a version ahead of the stored one is just as stale', async () => {
        const { id } = await setup();

        await refused(
          id,
          { version: 7, name: 'From the future' },
          409,
          'TIMELINES_VERSION_STALE',
        );
      });

      it('a request without a version, with version 0 or with a version that is not an integer is 400 on `version`, and nothing is written', async () => {
        const { id } = await setup();

        for (const payload of [
          { name: 'No version' },
          { version: 0, name: 'Zero' },
          { version: '1', name: 'Text' },
          { version: 1.5, name: 'Fraction' },
        ]) {
          const res = await refused(id, payload, 400, 'VALIDATION_FAILED');
          expect(fieldsOf(res).map(([field]) => field)).toContain('version');
        }
      });

      it('two edits at the same moment on the same version: exactly one applies, one audit row, version 2', async () => {
        const { id } = await setup();
        const before = (await detailOf(id)).body.data;
        const tablesBefore = tablesNow();
        const writesBefore = w.world.timelineWriteLog.length;

        const [a, b] = await Promise.all([
          patch(id, { version: 1, name: 'Race A' }),
          patch(
            id,
            { version: 1, name: 'Race B' },
            { token: bearer('sub-admin2') },
          ),
        ]);
        const settled = stored();

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        expect(statuses).toEqual([200, 409]);
        const loser = a.status === 409 ? a : b;
        const winner = a.status === 200 ? a : b;
        expectError(loser, 409, 'TIMELINES_VERSION_STALE');
        // The timeline read again is, whole, the winner's edit on what was read before.
        const expected = structuredClone(before);
        expected.name = a.status === 200 ? 'Race A' : 'Race B';
        expected.version = 2;
        const read = (await detailOf(id)).body.data;
        expect(read).toEqual(expected);
        expect(winner.body.data).toEqual(withoutUsers(read));
        // Exactly one edit ran a statement: the winner's update and its audit row.
        expect(w.world.timelineWriteLog.slice(writesBefore)).toEqual([
          `timeline:update:${id}`,
          `audit:${id}`,
        ]);
        const winnerId = a.status === 200 ? w.admin.id : userIdOf('sub-admin2');
        expect(w.world.auditEvents).toHaveLength(1);
        expect(w.world.auditEvents[0]).toMatchObject({
          timelineId: id,
          actorId: winnerId,
          requestId: winner.headers['x-request-id'],
        });
        // The stored rows: the timeline row carries the winner's name, version and author; no other table moved.
        const [timelineRows, ...childRows] = tablesNow();
        expect(timelineRows).toEqual([
          {
            ...tablesBefore[0]![0],
            name: expected.name,
            version: 2,
            updatedAt: expect.any(String),
            updatedBy: winnerId,
          },
        ]);
        expect(childRows).toEqual(tablesBefore.slice(1));
        expect(stored()).toBe(settled);
      });

      it('an edit racing a create of the same name: one timeline name wins, never two', async () => {
        const { cycleId, id } = await setup();
        const readBefore = (await detailOf(id)).body.data;
        const tablesBefore = tablesNow();
        const cyclesBefore = JSON.stringify(w.world.cycles);
        const writesBefore = w.world.timelineWriteLog.length;

        const [edit, create] = await Promise.all([
          patch(id, { version: 1, name: 'Contested' }),
          createTimeline(cycleId, { name: 'contested' }),
        ]);
        const settled = stored();

        const names = w.world.timelines.map((t) => t.name.toLowerCase());
        expect(names.filter((n) => n === 'contested')).toHaveLength(1);
        const successes = [edit.status === 200, create.status === 201].filter(
          Boolean,
        );
        expect(successes).toHaveLength(1);
        expectError(
          edit.status === 200 ? create : edit,
          409,
          'TIMELINES_NAME_TAKEN',
        );
        const readAfter = (await detailOf(id)).body.data;
        const tablesAfter = tablesNow();
        const writes = w.world.timelineWriteLog.slice(writesBefore);
        expect(JSON.stringify(w.world.cycles)).toBe(cyclesBefore);
        if (edit.status === 200) {
          // The edit won: the timeline is the one read before with the new name,
          // and the create that lost left no timeline, step, program or result type behind.
          const expected = structuredClone(readBefore);
          expected.name = 'Contested';
          expected.version = 2;
          expect(edit.body.data).toEqual(withoutUsers(expected));
          expect(readAfter).toEqual(expected);
          expect(
            w.world.timelines.filter((t) => t.cycleId === cycleId),
          ).toHaveLength(1);
          expect(tablesAfter[0]).toEqual([
            {
              ...tablesBefore[0]![0],
              name: 'Contested',
              version: 2,
              updatedAt: expect.any(String),
              updatedBy: w.admin.id,
            },
          ]);
          expect(tablesAfter.slice(1)).toEqual(tablesBefore.slice(1));
          expect(writes).toEqual([`timeline:update:${id}`, `audit:${id}`]);
          expect(w.world.auditEvents).toHaveLength(1);
        } else {
          // The create won: the losing edit left every row of the timeline as it was read.
          expect(readAfter).toEqual(readBefore);
          expect(
            w.world.timelines.filter((t) => t.cycleId === cycleId),
          ).toHaveLength(2);
          const own: Tables = [
            tablesAfter[0]!.filter((row) => row.id === id),
            ...tablesAfter
              .slice(1)
              .map((table) => table.filter((row) => row.timelineId === id)),
          ];
          expect(own).toEqual(tablesBefore);
          // Every statement that ran was the create's own: none touched this timeline.
          const createdId = create.body.data.id as number;
          expect(writes).toEqual([
            `timeline:additional:${createdId}`,
            `programs:${createdId}`,
            `result-types:${createdId}`,
            `steps:${createdId}`,
          ]);
          expect(w.world.auditEvents).toHaveLength(0);
        }
        expect(stored()).toBe(settled);
      });
    });

    describe('answer order', () => {
      it('a closed cycle wins over a stale version; a stale version wins over a rule problem; a catalog outage wins over a rule problem', async () => {
        const closed = await createCycle(2026);
        await activateCycle(closed);
        const created = await createTimeline(closed, {
          allPrograms: true,
          programIds: [],
          allResultTypes: true,
          resultTypeKeys: [],
        });
        const id = created.body.data.id as number;
        await activateCycle(await createCycle(2027));
        await refused(id, { version: 9, name: '' }, 409, 'CYCLES_CLOSED');

        const open = await createCycle(2028);
        const second = await createTimeline(open, {
          allPrograms: true,
          programIds: [],
          allResultTypes: true,
          resultTypeKeys: [],
        });
        const openId = second.body.data.id as number;
        await refused(
          openId,
          { version: 9, name: '' },
          409,
          'TIMELINES_VERSION_STALE',
        );

        const readBefore = await detailOf(openId);
        w.catalogs.programsDown = true;
        const before = stored();
        const down = await patch(openId, {
          version: 1,
          name: '',
          allPrograms: false,
          programIds: [1],
        });
        expectError(down, 503, 'SERVICE_UNAVAILABLE');
        expect(stored()).toBe(before);
        expect((await detailOf(openId)).body.data).toEqual(
          readBefore.body.data,
        );
        expect(readBefore.body.data).toMatchObject({
          version: 1,
          allPrograms: true,
        });
        expect(w.world.auditEvents).toHaveLength(0);
      });
    });

    describe('FR-10, FR-11: the audit record and the no-op', () => {
      it('one edit that changes the name and step 2 closing date stores exactly one audit row with those two fields, before and after, and nothing else', async () => {
        const { id } = await setup();

        const res = await patch(id, {
          version: 1,
          name: 'July 2026 v2',
          steps: [
            { position: 1, name: STEP_1.name },
            { position: 2, closesOn: '2026-11-14' },
          ],
        });

        expect(res.status).toBe(200);
        expect(w.world.auditEvents).toHaveLength(1);
        const [row] = w.world.auditEvents;
        expect(row).toMatchObject({
          timelineId: id,
          actorId: w.admin.id,
          action: 'update',
          requestId: res.headers['x-request-id'],
        });
        expect(row!.changes).toEqual({
          name: { before: 'July 2026', after: 'July 2026 v2' },
          'steps.2.closesOn': { before: '2026-11-13', after: '2026-11-14' },
        });
      });

      it('refusals of every kind (400, 404, 409) add no audit row', async () => {
        const { id } = await setup();

        const invalid = await refused(
          id,
          { version: 1, name: '' },
          400,
          'VALIDATION_FAILED',
        );
        expect(fieldsOf(invalid).map(([field]) => field)).toContain('name');
        const stale = await refused(
          id,
          { version: 5, name: 'X' },
          409,
          'TIMELINES_VERSION_STALE',
        );
        expect(stale.body.error.fields).toBeUndefined();
        const unknownField = await refused(
          id,
          { version: 1, audience: 'programs' },
          400,
          'VALIDATION_FAILED',
        );
        expect(fieldsOf(unknownField)).toEqual([['audience', 'UNKNOWN_FIELD']]);

        // 404: no timeline to read back, so the whole stored state and the
        // existing timeline are compared instead.
        const readBefore = await detailOf(id);
        const stateBefore = stored();
        const missing = await patch(999, { version: 1, name: 'X' });
        expectError(missing, 404, 'TIMELINES_NOT_FOUND');
        expect(stored()).toBe(stateBefore);
        expect((await detailOf(id)).body.data).toEqual(readBefore.body.data);

        expect(w.world.auditEvents).toEqual([]);
      });

      it('an edit with every field equal to the stored one is 200 with the same version, and no audit row, no write and no transaction', async () => {
        const { id } = await setup();
        const read = (await detailOf(id)).body.data;
        const before = stored();

        const res = await patch(id, {
          version: 1,
          name: read.name,
          allPrograms: false,
          programIds: [2],
          allResultTypes: false,
          resultTypeKeys: ['INNOVATION_DEV'],
          steps: [
            {
              position: 1,
              name: STEP_1.name,
              opensOn: '2026-11-02',
              closesOn: '2026-11-06',
            },
          ],
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(withoutUsers(read));
        expect(res.body.data.version).toBe(1);
        expect(stored()).toBe(before);
        expect(w.world.auditEvents).toHaveLength(0);
      });
    });

    describe('FR-13: Idempotency-Key on PATCH /timelines/:id', () => {
      it('a replay of an applied edit, version still 1, returns the first 200 marked as a replay: not 409 stale, no second audit row, nothing applied again', async () => {
        const { id } = await setup();
        const change = { version: 1, name: 'Edited once' };
        const first = await patch(id, change, { key: 'edit-1' });
        const committed = w.timelinesUnitOfWork.committed;
        const afterFirst = stored();

        const replay = await patch(id, change, { key: 'edit-1' });

        expect(first.status).toBe(200);
        expect(first.headers['idempotency-replayed']).toBeUndefined();
        expect(first.body.data.version).toBe(2);
        expect(replay.status).toBe(200);
        expect(replay.headers['idempotency-replayed']).toBe('true');
        expect(replay.body.data).toEqual(first.body.data);
        expect(w.world.auditEvents).toHaveLength(1);
        expect(w.timelinesUnitOfWork.committed).toBe(committed);
        expect(stored()).toBe(afterFirst);
        expect((await detailOf(id)).body.data.version).toBe(2);
      });

      it('the replay is the first answer even after another edit moved the timeline on', async () => {
        const { id } = await setup();
        const first = await patch(
          id,
          { version: 1, name: 'Edit A' },
          { key: 'edit-a' },
        );
        await patch(id, { version: 2, name: 'Edit B' });

        const replay = await patch(
          id,
          { version: 1, name: 'Edit A' },
          { key: 'edit-a' },
        );

        expect(replay.status).toBe(200);
        expect(replay.headers['idempotency-replayed']).toBe('true');
        expect(replay.body.data).toEqual(first.body.data);
        expect(w.world.auditEvents).toHaveLength(2);
        expect((await detailOf(id)).body.data.name).toBe('Edit B');
      });

      it('the same key with another body is 422 IDEMPOTENCY_KEY_REUSED and applies nothing', async () => {
        const { id } = await setup();
        await patch(id, { version: 1, name: 'Edited' }, { key: 'k-1' });
        const readBefore = await detailOf(id);
        const stateBefore = stored();

        const res = await patch(
          id,
          { version: 1, name: 'Different' },
          { key: 'k-1' },
        );

        expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
        expect((await detailOf(id)).body.data).toEqual(readBefore.body.data);
        expect(readBefore.body.data).toMatchObject({
          name: 'Edited',
          version: 2,
        });
        expect(stored()).toBe(stateBefore);
        expect(w.world.auditEvents).toHaveLength(1);
      });

      it('a replayed refusal is the same refusal, marked as a replay, and writes nothing', async () => {
        const { id } = await setup();
        const unchanged = await snapshot(id);

        const first = await patch(
          id,
          { version: 4, name: 'Late' },
          { key: 'stale-1' },
        );
        expectError(first, 409, 'TIMELINES_VERSION_STALE');
        await expectUnchanged(id, unchanged);

        const replay = await patch(
          id,
          { version: 4, name: 'Late' },
          { key: 'stale-1' },
        );
        expectError(replay, 409, 'TIMELINES_VERSION_STALE');
        expect(replay.headers['idempotency-replayed']).toBe('true');
        await expectUnchanged(id, unchanged);
        expect(w.world.auditEvents).toHaveLength(0);
      });

      it('a key left executed without an answer (the crash window) replays the timeline as it is now: 200 marked as a replay, not 409 stale, no second audit row', async () => {
        const { id } = await setup();
        const change = { version: 1, name: 'Edited once' };
        const first = await patch(id, change, { key: 'crash-1' });
        // The process died after the commit and before the answer was stored.
        const row = w.idempotency.peek(w.admin.id, 'crash-1')!;
        w.idempotency.seed({
          ...row,
          state: 'executed',
          responseStatus: null,
          responseBody: null,
        });
        const afterFirst = stored();

        const replay = await patch(id, change, { key: 'crash-1' });

        expect(first.status).toBe(200);
        expect(replay.status).toBe(200);
        expect(replay.headers['idempotency-replayed']).toBe('true');
        expect(replay.body.data).toMatchObject({
          id,
          name: 'Edited once',
          version: 2,
        });
        expect(w.world.auditEvents).toHaveLength(1);
        expect(stored()).toBe(afterFirst);
      });

      it('without a key the same repeat is the plain 409 stale, with no replay header and no key row', async () => {
        const { id } = await setup();
        await patch(id, { version: 1, name: 'Edited' });
        const readBefore = await detailOf(id);
        const stateBefore = stored();

        const again = await patch(id, { version: 1, name: 'Edited' });

        expectError(again, 409, 'TIMELINES_VERSION_STALE');
        expect(again.headers['idempotency-replayed']).toBeUndefined();
        expect(w.db.idempotency).toHaveLength(0);
        expect((await detailOf(id)).body.data).toEqual(readBefore.body.data);
        expect(readBefore.body.data).toMatchObject({
          name: 'Edited',
          version: 2,
        });
        expect(stored()).toBe(stateBefore);
        expect(w.world.auditEvents).toHaveLength(1);
      });
    });

    describe('NFR-7: the decision line', () => {
      it('every edit logs exactly one `timeline_update` line with ids and fixed words, and no name, date or body reaches any log', async () => {
        const { cycleId, id } = await setup();
        await createTimeline(cycleId, { name: 'Taken Name' });
        spy.lines.length = 0;
        const ok = await patch(id, { version: 1, name: 'Confidential Rename' });
        const afterOk = await snapshot(id);
        expect(ok.status).toBe(200);
        expect(afterOk.read).toMatchObject({
          name: 'Confidential Rename',
          version: 2,
        });
        // Each refusal leaves the timeline as the edit left it: the whole read and the stored state.
        const stale = await patch(id, {
          version: 1,
          name: 'Confidential Stale',
        });
        expectError(stale, 409, 'TIMELINES_VERSION_STALE');
        await expectUnchanged(id, afterOk);
        const invalid = await patch(id, { version: 2, name: '' });
        expectError(invalid, 400, 'VALIDATION_FAILED');
        await expectUnchanged(id, afterOk);
        const taken = await patch(id, { version: 2, name: 'TAKEN NAME' });
        expectError(taken, 409, 'TIMELINES_NAME_TAKEN');
        await expectUnchanged(id, afterOk);
        const missing = await patch(999, {
          version: 1,
          name: 'Confidential Ghost',
        });
        expectError(missing, 404, 'TIMELINES_NOT_FOUND');
        await expectUnchanged(id, afterOk);
        expect(w.world.auditEvents).toHaveLength(1);

        const lineOf = (res: request.Response) =>
          spy
            .eventsOf('admin_config', res.headers['x-request-id'] as string)
            .filter((line) => line.action === 'timeline_update');
        const base = {
          event: 'admin_config',
          action: 'timeline_update',
          actorId: w.admin.id,
          idempotency: 'none',
        };
        expect(lineOf(ok)).toEqual([
          {
            ...base,
            targetId: id,
            outcome: 'ok',
            requestId: ok.headers['x-request-id'],
          },
        ]);
        expect(lineOf(stale)).toMatchObject([
          { ...base, outcome: 'refused', reason: 'TIMELINES_VERSION_STALE' },
        ]);
        expect(lineOf(invalid)).toMatchObject([
          { outcome: 'refused', reason: 'VALIDATION_FAILED' },
        ]);
        expect(lineOf(taken)).toMatchObject([
          { outcome: 'refused', reason: 'TIMELINES_NAME_TAKEN' },
        ]);
        expect(lineOf(missing)).toMatchObject([
          { outcome: 'refused', reason: 'TIMELINES_NOT_FOUND' },
        ]);
        expect(
          spy.lines.filter((l) =>
            /confidential|taken name|2026-11|INNOVATION_DEV/i.test(l),
          ),
        ).toEqual([]);
      });
    });
  });

  // --- FR-14, FR-15: the users of a timeline ------------------------------------

  describe('FR-14, FR-15: POST /timelines/:id/users and DELETE /timelines/:id/users/:assignmentId', () => {
    /** Cycle 2026 with one timeline (steps for Assessors and Science Programs). */
    const setup = async () => {
      const cycleId = await createCycle(2026);
      const created = await createTimeline(cycleId);
      expect(created.status).toBe(201);
      return { cycleId, timelineId: created.body.data.id as number };
    };
    const detailOf = async (timelineId: number) => {
      const res = await w.send('get', `/timelines/${timelineId}`);
      expect(res.status).toBe(200);
      return res.body.data;
    };
    /** The cycle 2026 is closed by the activation of 2027. */
    const closeCycle = async (cycleId: number) => {
      await activateCycle(cycleId);
      await activateCycle(await createCycle(2027));
    };
    /** A user with an ASSESSOR and a TPB grant, switched off. */
    const inactiveUser = async () => {
      const user = await w.users.create({
        email: 'off@cgiar.org',
        firstName: 'Off',
        lastName: 'User',
        authSource: 'custom',
        nickname: null,
      });
      await w.assignments.create({
        userId: user.id,
        roleCode: 'ASSESSOR',
        resultTypeKey: 'KP',
      });
      await w.assignments.create({ userId: user.id, roleCode: 'TPB' });
      await w.users.update(user.id, { isActive: false });
      return user;
    };
    const grantOf = (userId: number, roleCode: string) => {
      const role = w.db.roles.find((r) => r.code === roleCode)!;
      return w.db.assignments.find(
        (a) => a.userId === userId && a.roleId === role.id,
      )!;
    };

    it('assigns a live ASSESSOR who holds another role: 201 with the assignment, then a repeat is 200 with the same data and no second row', async () => {
      const { timelineId } = await setup();
      const userId = userIdOf('sub-multi_grant'); // ASSESSOR and TPB

      const first = await assign(timelineId, userId, 'ASSESSOR');
      const again = await assign(timelineId, userId, 'ASSESSOR');

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        success: true,
        meta: { requestId: first.headers['x-request-id'] },
      });
      expect(first.body.data).toEqual({
        assignmentId: 1,
        userId,
        firstName: 'sub-multi_grant',
        lastName: 'Actor',
        email: 'sub-multi_grant@cgiar.org',
        role: 'ASSESSOR',
        assignedAt: ISO,
      });
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual(first.body.data);
      expect(w.world.assignments).toHaveLength(1);
      // The database key, not a read, refused the second row.
      expect(w.world.assignmentKeyViolations).toBe(1);
    });

    it('the detail lists her, and `users`, `assignedCount` and `readiness` agree after the assign and again after the remove; the row is kept', async () => {
      const { timelineId } = await setup();
      expect((await detailOf(timelineId)).readiness).toEqual([
        'NO_RESULTS_LOADED',
        'NO_ASSESSOR_ASSIGNED',
      ]);

      const assigned = await assign(
        timelineId,
        userIdOf('sub-multi_grant'),
        'ASSESSOR',
      );
      const afterAssign = await detailOf(timelineId);
      const removed = await unassign(
        timelineId,
        assigned.body.data.assignmentId,
      );
      const afterRemove = await detailOf(timelineId);

      expect(afterAssign.users).toEqual([assigned.body.data]);
      expect(afterAssign.assignedCount).toEqual({
        ASSESSOR: 1,
        LEAD_ASSESSOR: 0,
        TPB: 0,
        PPU: 0,
      });
      expect(afterAssign.readiness).toEqual(['NO_RESULTS_LOADED']);
      expect(removed.status).toBe(204);
      expect(removed.text).toBe('');
      expect(afterRemove.users).toEqual([]);
      expect(afterRemove.assignedCount.ASSESSOR).toBe(0);
      expect(afterRemove.readiness).toEqual([
        'NO_RESULTS_LOADED',
        'NO_ASSESSOR_ASSIGNED',
      ]);
      expect(w.world.assignments).toHaveLength(1);
      expect(w.world.assignments[0]).toMatchObject({
        removedAt: new Date(ISO),
        removedBy: w.admin.id,
        activeKey: null,
      });
    });

    it('one user in two roles is two entries, and two users in one role are two entries', async () => {
      const { timelineId } = await setup();
      const multi = userIdOf('sub-multi_grant');

      const a = await assign(timelineId, multi, 'ASSESSOR');
      const b = await assign(timelineId, multi, 'TPB');
      const c = await assign(timelineId, userIdOf('sub-assessor'), 'ASSESSOR');

      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
      const detail = await detailOf(timelineId);
      expect(detail.users.map((u: any) => [u.userId, u.role])).toEqual([
        [multi, 'ASSESSOR'],
        [multi, 'TPB'],
        [userIdOf('sub-assessor'), 'ASSESSOR'],
      ]);
      expect(detail.assignedCount).toEqual({
        ASSESSOR: 2,
        LEAD_ASSESSOR: 0,
        TPB: 1,
        PPU: 0,
      });
    });

    it.each([
      ['ADMIN', { role: 'ADMIN' }],
      ['PROGRAM', { role: 'PROGRAM' }],
      ['an unknown role', { role: 'GUEST' }],
      ['a role in lower case', { role: 'assessor' }],
    ])(
      '%s is 400 VALIDATION_FAILED on `role` before anything is read, written or looked up',
      async (_label, over) => {
        const { timelineId } = await setup();
        const before = nothingRan();

        const res = await w.send('post', `/timelines/${timelineId}/users`, {
          body: { userId: userIdOf('sub-multi_grant'), ...over },
        });

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res)).toEqual([['role', 'INVALID']]);
        expect(nothingRan()).toEqual(before);
      },
    );

    it.each([
      ['a missing userId', undefined],
      ['zero', 0],
      ['a negative number', -3],
      ['a fraction', 1.5],
      ['a string', '7'],
      ['null', null],
      ['more than an unsigned int', 4294967296],
    ])(
      '%s is 400 VALIDATION_FAILED on `userId` and nothing runs',
      async (_label, userId) => {
        const { timelineId } = await setup();
        const before = nothingRan();

        const res = await assign(timelineId, userId, 'ASSESSOR');

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(new Set(fieldsOf(res).map(([field]) => field))).toEqual(
          new Set(['userId']),
        );
        expect(nothingRan()).toEqual(before);
      },
    );

    it('a body without a role, and a path id that is not a number, are 400 and nothing runs', async () => {
      const { timelineId } = await setup();
      const before = nothingRan();

      const noRole = await w.send('post', `/timelines/${timelineId}/users`, {
        body: { userId: 3 },
      });
      const badTimeline = await assign('abc' as never, 3, 'ASSESSOR');
      const badAssignment = await unassign(timelineId, 'abc');

      expectError(noRole, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(noRole).map(([field]) => field)).toEqual(['role']);
      expectError(badTimeline, 400, 'VALIDATION_FAILED');
      expectError(badAssignment, 400, 'VALIDATION_FAILED');
      expect(nothingRan()).toEqual(before);
    });

    it('an unknown user is 404 USERS_NOT_FOUND and an unknown timeline 404 TIMELINES_NOT_FOUND, with nothing written', async () => {
      const { timelineId } = await setup();
      const before = rows();

      const noUser = await assign(timelineId, 99999, 'ASSESSOR');
      const noTimeline = await assign(
        999,
        userIdOf('sub-assessor'),
        'ASSESSOR',
      );

      expectError(noUser, 404, 'USERS_NOT_FOUND');
      expectError(noTimeline, 404, 'TIMELINES_NOT_FOUND');
      expect(rows()).toBe(before);
    });

    it('refuses with 409 TIMELINES_USER_NOT_ELIGIBLE an inactive user, a user without the role, and a user whose grant was revoked; each of them holds another live role', async () => {
      const { timelineId } = await setup();
      const off = await inactiveUser();
      const multi = userIdOf('sub-multi_grant');
      await w.db.stores.assignments.revoke(
        grantOf(multi, 'ASSESSOR').id,
        w.admin.id,
        new Date(ISO),
      );
      const before = rows();

      const refused = [
        await assign(timelineId, off.id, 'ASSESSOR'), // inactive; ASSESSOR and TPB grants
        await assign(timelineId, userIdOf('sub-lead_assessor'), 'ASSESSOR'), // only LEAD_ASSESSOR
        await assign(timelineId, userIdOf('sub-assessor'), 'PPU'), // only ASSESSOR
        await assign(timelineId, multi, 'ASSESSOR'), // ASSESSOR revoked, TPB live
      ];

      for (const res of refused) {
        expectError(res, 409, 'TIMELINES_USER_NOT_ELIGIBLE');
      }
      expect(rows()).toBe(before);
      // Her live TPB grant still qualifies her for TPB.
      expect((await assign(timelineId, multi, 'TPB')).status).toBe(201);
    });

    it('a closed cycle is 409 CYCLES_CLOSED for an assign and for a remove, and writes nothing', async () => {
      const { cycleId, timelineId } = await setup();
      const assigned = await assign(
        timelineId,
        userIdOf('sub-multi_grant'),
        'ASSESSOR',
      );
      await closeCycle(cycleId);
      const before = rows();

      const late = await assign(
        timelineId,
        userIdOf('sub-assessor'),
        'ASSESSOR',
      );
      const lateRemove = await unassign(
        timelineId,
        assigned.body.data.assignmentId,
      );

      expectError(late, 409, 'CYCLES_CLOSED');
      expectError(lateRemove, 409, 'CYCLES_CLOSED');
      expect(rows()).toBe(before);
      expect(w.world.assignments[0]!.removedAt).toBeNull();
    });

    it('a second remove is 404 TIMELINES_ASSIGNMENT_NOT_FOUND, and so is an assignment of another timeline, an unknown one, and an unknown timeline', async () => {
      const { cycleId, timelineId } = await setup();
      const other = await createTimeline(cycleId, { name: 'Other' });
      const otherId = other.body.data.id as number;
      const mine = await assign(
        timelineId,
        userIdOf('sub-assessor'),
        'ASSESSOR',
      );
      const theirs = await assign(
        otherId,
        userIdOf('sub-assessor'),
        'ASSESSOR',
      );
      const myId = mine.body.data.assignmentId as number;
      expect((await unassign(timelineId, myId)).status).toBe(204);
      const before = rows();

      const again = await unassign(timelineId, myId);
      const elsewhere = await unassign(
        timelineId,
        theirs.body.data.assignmentId,
      );
      const unknown = await unassign(timelineId, 99999);
      const noTimeline = await unassign(999, myId);

      expectError(again, 404, 'TIMELINES_ASSIGNMENT_NOT_FOUND');
      expectError(elsewhere, 404, 'TIMELINES_ASSIGNMENT_NOT_FOUND');
      expectError(unknown, 404, 'TIMELINES_ASSIGNMENT_NOT_FOUND');
      expectError(noTimeline, 404, 'TIMELINES_NOT_FOUND');
      expect(rows()).toBe(before);
      expect(
        w.world.assignments.filter((a) => a.removedAt === null),
      ).toHaveLength(1);
    });

    it('a re-assign after a removal is 201 with a new assignment id, and the detail lists only the new one', async () => {
      const { timelineId } = await setup();
      const userId = userIdOf('sub-multi_grant');
      const first = await assign(timelineId, userId, 'ASSESSOR');
      await unassign(timelineId, first.body.data.assignmentId);

      const again = await assign(timelineId, userId, 'ASSESSOR');

      expect(again.status).toBe(201);
      expect(again.body.data.assignmentId).toBe(2);
      expect((await detailOf(timelineId)).users).toEqual([again.body.data]);
      expect(w.world.assignments).toHaveLength(2);
      expect(w.world.assignmentKeyViolations).toBe(0);
    });

    it('two identical assigns sent at once leave one active row and the same assignment id in both answers', async () => {
      const { timelineId } = await setup();
      const userId = userIdOf('sub-multi_grant');

      const [a, b] = await Promise.all([
        assign(timelineId, userId, 'ASSESSOR'),
        assign(timelineId, userId, 'ASSESSOR'),
      ]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
      expect(a.body.data.assignmentId).toBe(b.body.data.assignmentId);
      expect(w.world.assignments).toHaveLength(1);
      expect(w.world.assignments[0]!.removedAt).toBeNull();
    });

    it('every assign and remove logs exactly one line with ids and fixed words, and no name or email reaches any log', async () => {
      const { timelineId } = await setup();
      const multi = userIdOf('sub-multi_grant');
      const assigned = await assign(timelineId, multi, 'ASSESSOR');
      const repeated = await assign(timelineId, multi, 'ASSESSOR');
      const refused = await assign(
        timelineId,
        userIdOf('sub-lead_assessor'),
        'ASSESSOR',
      );
      const id = assigned.body.data.assignmentId as number;
      const removed = await unassign(timelineId, id);
      const removedAgain = await unassign(timelineId, id);

      const lineOf = (res: request.Response, action: string) =>
        spy
          .eventsOf('admin_config', res.headers['x-request-id'] as string)
          .filter((line) => line.action === action);
      const base = {
        event: 'admin_config',
        actorId: w.admin.id,
        idempotency: 'none',
      };
      expect(lineOf(assigned, 'timeline_user_assign')).toEqual([
        {
          ...base,
          action: 'timeline_user_assign',
          targetId: id,
          outcome: 'ok',
          requestId: assigned.headers['x-request-id'],
        },
      ]);
      expect(lineOf(repeated, 'timeline_user_assign')).toMatchObject([
        { targetId: id, outcome: 'ok' },
      ]);
      expect(lineOf(refused, 'timeline_user_assign')).toMatchObject([
        {
          targetId: null,
          outcome: 'refused',
          reason: 'TIMELINES_USER_NOT_ELIGIBLE',
        },
      ]);
      expect(lineOf(removed, 'timeline_user_remove')).toEqual([
        {
          ...base,
          action: 'timeline_user_remove',
          targetId: id,
          outcome: 'ok',
          requestId: removed.headers['x-request-id'],
        },
      ]);
      expect(lineOf(removedAgain, 'timeline_user_remove')).toMatchObject([
        {
          targetId: null,
          outcome: 'refused',
          reason: 'TIMELINES_ASSIGNMENT_NOT_FOUND',
        },
      ]);
      expect(spy.lines.filter((l) => /@cgiar\.org|Actor/.test(l))).toEqual([]);
    });

    it('documents both routes in OpenAPI: the codes each can answer, the parameters, the body with its four roles, and no key header', () => {
      const doc = buildOpenApiDocument(w.app);
      const paths = doc.paths as Record<string, Record<string, any>>;
      const post = paths['/api/v1/timelines/{id}/users']!.post;
      const del = paths['/api/v1/timelines/{id}/users/{assignmentId}']!.delete;

      expect(post.summary).toBeTruthy();
      expect(Object.keys(post.responses)).toEqual(
        expect.arrayContaining([
          '200',
          '201',
          '400',
          '401',
          '403',
          '404',
          '409',
        ]),
      );
      expect(post.parameters.map((p: { name: string }) => p.name)).toEqual([
        'id',
      ]);
      expect(JSON.stringify(post.requestBody)).toContain(
        '#/components/schemas/AssignTimelineUserDto',
      );
      expect(JSON.stringify(post.responses['201'])).toContain(
        '#/components/schemas/TimelineUserModel',
      );
      expect(JSON.stringify(post.responses['200'])).toContain(
        '#/components/schemas/TimelineUserModel',
      );
      expect(del.summary).toBeTruthy();
      expect(Object.keys(del.responses)).toEqual(
        expect.arrayContaining(['204', '401', '403', '404', '409']),
      );
      expect(Object.keys(del.responses)).not.toContain('200');
      expect(del.parameters.map((p: { name: string }) => p.name)).toEqual([
        'id',
        'assignmentId',
      ]);
      const schemas = doc.components?.schemas as Record<string, any>;
      expect(Object.keys(schemas.AssignTimelineUserDto.properties)).toEqual([
        'userId',
        'role',
      ]);
      expect(schemas.AssignTimelineUserDto.properties.role.enum).toEqual([
        'ASSESSOR',
        'LEAD_ASSESSOR',
        'TPB',
        'PPU',
      ]);
      expect(schemas.AssignTimelineUserDto.required).toEqual(
        expect.arrayContaining(['userId', 'role']),
      );
      expect(schemas.TimelineUserModel.properties.firstName.nullable).toBe(
        true,
      );
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

    it("documents the timeline-edit read additions: the waiting_for_load status, each step's state and the version (FR-14)", () => {
      const doc = buildOpenApiDocument(w.app);
      const schemas = doc.components?.schemas as Record<string, any>;

      expect(schemas.TimelineModel.properties.status.enum).toEqual([
        'scheduled',
        'waiting_for_load',
        'live',
        'finished',
      ]);
      expect(schemas.TimelineModel.properties.version.type).toBe('number');
      expect(schemas.TimelineModel.required).toContain('version');
      expect(schemas.TimelineStepModel.properties.state.enum).toEqual([
        'closed',
        'in_progress',
        'upcoming',
      ]);
      expect(schemas.TimelineStepModel.required).toContain('state');
      // The detail carries them too, beside its users.
      expect(schemas.TimelineDetailModel.properties.status.enum).toContain(
        'waiting_for_load',
      );
      expect(schemas.TimelineDetailModel.required).toContain('version');
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
