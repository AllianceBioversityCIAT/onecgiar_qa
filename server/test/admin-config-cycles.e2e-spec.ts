import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { CyclesController } from '../src/admin-config/cycles/cycles.controller.js';
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

// Cycles over the real app (cycle-timelines T-5): FR-1 (create, duplicate,
// invalid year), FR-2 (list), FR-3 (switch, not a draft), FR-16 (admin only),
// FR-17 (safe retries on create), NFR-1, NFR-2, NFR-3, NFR-7. The guards, the
// pipe, the filter, the idempotency interceptor and OpenAPI are real; the
// stores and the clocks are the in-memory world. Every cycle is created and
// activated through the routes. Expected values are the spec's, written out.

const ISO = '2026-10-20T10:00:00.000Z';
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

const fieldsOf = (res: request.Response): Array<[string, string]> =>
  (res.body.error.fields as Array<{ field: string; code: string }>).map(
    ({ field, code }) => [field, code],
  );

describe('Cycles routes (e2e)', () => {
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
    expect(res.status, `create ${year}`).toBe(201);
    return res.body.data.id as number;
  };
  const activateCycle = async (id: number) => {
    const res = await w.send('post', `/cycles/${id}/activate`);
    expect(res.status, `activate ${id}`).toBe(200);
    return res;
  };
  const rows = () => JSON.stringify(w.world.cycles);

  // --- FR-16, NFR-1: every route is admin only --------------------------------

  describe('FR-16: access', () => {
    type Route = [
      'create' | 'list' | 'activate',
      'get' | 'post',
      string,
      object?,
    ];
    const ROUTES: Route[] = [
      ['create', 'post', '/cycles', { year: 2031 }],
      ['list', 'get', '/cycles'],
      ['activate', 'post', '/cycles/1/activate'],
    ];

    it('has a 403 row for every grantable role (a new role without one fails here)', () => {
      const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
      for (const { code } of GRANTABLE_ROLES) {
        expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
      }
    });

    it.each(ROUTES)(
      '%s: 401 without a token, and with a token that is not valid, before anything else',
      async (_name, method, path, body) => {
        await createCycle(2030);
        const before = { rows: rows(), begun: w.unitOfWork.begun };

        for (const token of [null, 'Bearer not-a-token']) {
          const res = await w.send(method, path, {
            token,
            ...(body ? { body } : {}),
          });
          expectError(res, 401, 'AUTH_TOKEN_INVALID');
        }

        expect({ rows: rows(), begun: w.unitOfWork.begun }).toEqual(before);
      },
    );

    for (const role of NON_ADMINS) {
      it.each(ROUTES)(
        `%s: ${role} gets 403 AUTH_PERMISSION_DENIED and nothing is read or written`,
        async (_name, method, path, body) => {
          await createCycle(2030);
          const before = {
            rows: rows(),
            begun: w.unitOfWork.begun,
            queries: w.world.store.queries,
          };

          const res = await w.send(method, path, {
            token: bearer(`sub-${role.toLowerCase()}`),
            ...(body ? { body } : {}),
          });

          expectError(res, 403, 'AUTH_PERMISSION_DENIED');
          expect({
            rows: rows(),
            begun: w.unitOfWork.begun,
            queries: w.world.store.queries,
          }).toEqual(before);
        },
      );
    }

    it('an ADMIN gets through every route (so a route that lost its guard decision fails here)', async () => {
      const created = await w.send('post', '/cycles', { body: { year: 2031 } });
      const listed = await w.send('get', '/cycles');
      const activated = await w.send('post', '/cycles/1/activate');

      expect([created.status, listed.status, activated.status]).toEqual([
        201, 200, 200,
      ]);
    });

    it('declares ADMIN_ACCESS on each of its 3 routes and none as public', () => {
      const reflector = new Reflector();
      const served = Object.getOwnPropertyNames(CyclesController.prototype)
        .map((name) => CyclesController.prototype[name as never] as unknown)
        .filter(
          (handler): handler is (...args: never[]) => unknown =>
            typeof handler === 'function',
        )
        .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
        .map((handler) => ({
          route: `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} ${(
            Reflect.getMetadata(PATH_METADATA, handler) as string
          ).replace(/^\//, '')}`,
          permission: reflector.getAllAndOverride(REQUIRE_PERMISSION_KEY, [
            handler,
            CyclesController,
          ]),
          isPublic: reflector.getAllAndOverride(IS_PUBLIC_KEY, [
            handler,
            CyclesController,
          ]),
        }))
        .sort((a, b) => a.route.localeCompare(b.route));

      expect(served).toEqual([
        { route: 'GET ', permission: 'ADMIN_ACCESS', isPublic: undefined },
        { route: 'POST ', permission: 'ADMIN_ACCESS', isPublic: undefined },
        {
          route: 'POST :id/activate',
          permission: 'ADMIN_ACCESS',
          isPublic: undefined,
        },
      ]);
    });
  });

  // --- FR-1: create -----------------------------------------------------------

  describe('FR-1: POST /cycles', () => {
    it('creates a draft cycle: 201, the display name, no timelines, and who and when are stored', async () => {
      const res = await w.send('post', '/cycles', { body: { year: 2027 } });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toEqual({
        id: 1,
        year: 2027,
        name: '2027 cycle',
        status: 'draft',
        timelineCount: 0,
        startsOn: null,
        endsOn: null,
        createdAt: ISO,
      });
      expect(w.world.cycles).toHaveLength(1);
      expect(w.world.cycles[0]).toMatchObject({
        year: 2027,
        status: 'draft',
        createdBy: w.admin.id,
        createdAt: new Date(ISO),
        activatedAt: null,
      });
    });

    it('does not make it active, and leaves the active cycle active', async () => {
      const first = await createCycle(2026);
      await activateCycle(first);

      await createCycle(2027);

      const list = await w.send('get', '/cycles');
      expect(
        list.body.data.map((c: { year: number; status: string }) => [
          c.year,
          c.status,
        ]),
      ).toEqual([
        [2027, 'draft'],
        [2026, 'active'],
      ]);
    });

    it('refuses a duplicate year with 409 CYCLES_YEAR_TAKEN and writes nothing', async () => {
      await createCycle(2026);
      const before = rows();

      const res = await w.send('post', '/cycles', { body: { year: 2026 } });

      expectError(res, 409, 'CYCLES_YEAR_TAKEN');
      expect(rows()).toBe(before);
    });

    it('two creates of one year at the same time: one 201 and one 409, one row', async () => {
      const [a, b] = await Promise.all([
        w.send('post', '/cycles', { body: { year: 2026 } }),
        w.send('post', '/cycles', { body: { year: 2026 } }),
      ]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      const refused = a.status === 409 ? a : b;
      expectError(refused, 409, 'CYCLES_YEAR_TAKEN');
      expect(w.world.cycles).toHaveLength(1);
    });

    it.each<[string, object, Array<[string, string]>]>([
      ['a missing year', {}, [['year', 'REQUIRED']]],
      ['a null year', { year: null }, [['year', 'REQUIRED']]],
      ['a year sent as text', { year: '2026' }, [['year', 'INVALID_TYPE']]],
      ['a fractional year', { year: 2026.5 }, [['year', 'INVALID_TYPE']]],
      ['2019', { year: 2019 }, [['year', 'OUT_OF_RANGE']]],
      ['2101', { year: 2101 }, [['year', 'OUT_OF_RANGE']]],
      [
        'a field the API does not know (NFR-2)',
        { year: 2027, kind: 'official' },
        [['kind', 'UNKNOWN_FIELD']],
      ],
    ])(
      'refuses %s with 400 naming the field and writes nothing',
      async (_name, body, fields) => {
        const res = await w.send('post', '/cycles', { body });

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res)).toEqual(fields);
        expect(w.world.cycles).toHaveLength(0);
      },
    );

    it('refuses a body that is not valid JSON with 400 MALFORMED_JSON', async () => {
      const res = await request(w.app.getHttpServer())
        .post('/api/v1/cycles')
        .set('Authorization', w.adminToken)
        .set('Content-Type', 'application/json')
        .send('{"year":');

      expectError(res, 400, 'MALFORMED_JSON');
      expect(w.world.cycles).toHaveLength(0);
    });
  });

  // --- FR-2: list -------------------------------------------------------------

  describe('FR-2: GET /cycles', () => {
    it('lists every cycle, newest year first, with its status, count and date range (empty without timelines)', async () => {
      await createCycle(2027);
      const id2026 = await createCycle(2026);
      await createCycle(2028);
      await activateCycle(id2026);

      const res = await w.send('get', '/cycles');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          id: 3,
          year: 2028,
          name: '2028 cycle',
          status: 'draft',
          timelineCount: 0,
          startsOn: null,
          endsOn: null,
          createdAt: ISO,
        },
        {
          id: 1,
          year: 2027,
          name: '2027 cycle',
          status: 'draft',
          timelineCount: 0,
          startsOn: null,
          endsOn: null,
          createdAt: ISO,
        },
        {
          id: 2,
          year: 2026,
          name: '2026 cycle',
          status: 'active',
          timelineCount: 0,
          startsOn: null,
          endsOn: null,
          createdAt: ISO,
        },
      ]);
    });

    it('is an empty list, not an error, before the first cycle', async () => {
      const res = await w.send('get', '/cycles');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // --- FR-3: activate ---------------------------------------------------------

  describe('FR-3: POST /cycles/:id/activate', () => {
    it('makes the draft active and closes the previous active cycle', async () => {
      const first = await createCycle(2026);
      const second = await createCycle(2027);
      await activateCycle(first);

      const res = await activateCycle(second);

      expect(res.body.data).toMatchObject({
        id: second,
        year: 2027,
        status: 'active',
      });
      const list = await w.send('get', '/cycles');
      expect(
        list.body.data.map((c: { year: number; status: string }) => [
          c.year,
          c.status,
        ]),
      ).toEqual([
        [2027, 'active'],
        [2026, 'closed'],
      ]);
      expect(w.world.cycles.find((c) => c.id === first)).toMatchObject({
        closedBy: w.admin.id,
        closedAt: new Date(ISO),
        activatedAt: new Date(ISO),
      });
    });

    it.each(['active', 'closed'] as const)(
      'refuses a %s cycle with 409 CYCLES_NOT_DRAFT and changes nothing',
      async (status) => {
        const first = await createCycle(2026);
        const second = await createCycle(2027);
        await activateCycle(first);
        if (status === 'closed') await activateCycle(second);
        const before = rows();

        const res = await w.send('post', `/cycles/${first}/activate`);

        expectError(res, 409, 'CYCLES_NOT_DRAFT');
        expect(rows()).toBe(before);
      },
    );

    it('answers 404 CYCLES_NOT_FOUND for an unknown cycle', async () => {
      await createCycle(2026);

      const res = await w.send('post', '/cycles/999/activate');

      expectError(res, 404, 'CYCLES_NOT_FOUND');
    });

    it.each<[string, string]>([
      ['abc', 'INVALID_TYPE'],
      ['0', 'INVALID'],
      ['-1', 'INVALID'],
      ['1.5', 'INVALID_TYPE'],
    ])(
      'refuses the id "%s" with 400 on `id`, never a lookup',
      async (id, code) => {
        const res = await w.send('post', `/cycles/${id}/activate`);

        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res)).toEqual([['id', code]]);
      },
    );

    it('two activations at once never leave two active cycles, or none', async () => {
      const first = await createCycle(2026);
      const second = await createCycle(2027);
      const third = await createCycle(2028);
      await activateCycle(first);

      const [a, b] = await Promise.all([
        w.send('post', `/cycles/${second}/activate`),
        w.send('post', `/cycles/${third}/activate`),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const statuses = w.world.cycles.map((c) => c.status).sort();
      expect(statuses).toEqual(['active', 'closed', 'closed']);
    });

    it('two activations of the same draft: one 200 and one 409 CYCLES_NOT_DRAFT', async () => {
      const first = await createCycle(2026);
      const second = await createCycle(2027);
      await activateCycle(first);

      const [a, b] = await Promise.all([
        w.send('post', `/cycles/${second}/activate`),
        w.send('post', `/cycles/${second}/activate`),
      ]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
      expectError(a.status === 409 ? a : b, 409, 'CYCLES_NOT_DRAFT');
      expect(w.world.cycles.map((c) => [c.year, c.status])).toEqual([
        [2026, 'closed'],
        [2027, 'active'],
      ]);
    });

    it('is not keyed: an Idempotency-Key on it stores nothing', async () => {
      const id = await createCycle(2026);

      const res = await w.send('post', `/cycles/${id}/activate`, {
        key: 'activate-1',
      });

      expect(res.status).toBe(200);
      expect(res.headers['idempotency-replayed']).toBeUndefined();
      expect(w.db.idempotency).toHaveLength(0);
    });
  });

  // --- FR-17: safe retries on create -------------------------------------------

  describe('FR-17: Idempotency-Key on POST /cycles', () => {
    it('a replay with the same key returns the same 201 and the same cycle, marked as a replay, and creates nothing', async () => {
      const first = await w.send('post', '/cycles', {
        key: 'create-2027',
        body: { year: 2027 },
      });
      const committed = w.unitOfWork.committed;

      const replay = await w.send('post', '/cycles', {
        key: 'create-2027',
        body: { year: 2027 },
      });

      expect(first.status).toBe(201);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(first.body.data);
      expect(w.world.cycles).toHaveLength(1);
      expect(w.unitOfWork.committed).toBe(committed);
    });

    it('a replayed refusal is the same refusal, marked as a replay', async () => {
      await createCycle(2026);

      const first = await w.send('post', '/cycles', {
        key: 'dup-2026',
        body: { year: 2026 },
      });
      const replay = await w.send('post', '/cycles', {
        key: 'dup-2026',
        body: { year: 2026 },
      });

      expectError(first, 409, 'CYCLES_YEAR_TAKEN');
      expectError(replay, 409, 'CYCLES_YEAR_TAKEN');
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(w.world.cycles).toHaveLength(1);
    });

    it('the same key with another body is 422 IDEMPOTENCY_KEY_REUSED and creates nothing', async () => {
      await w.send('post', '/cycles', { key: 'k-1', body: { year: 2027 } });

      const res = await w.send('post', '/cycles', {
        key: 'k-1',
        body: { year: 2028 },
      });

      expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
      expect(w.world.cycles.map((c) => c.year)).toEqual([2027]);
    });

    it('a key belongs to the admin who sent it: another admin with the same key runs their own create', async () => {
      const mine = await w.send('post', '/cycles', {
        key: 'shared-key',
        body: { year: 2030 },
      });
      const theirs = await w.send('post', '/cycles', {
        key: 'shared-key',
        token: bearer('sub-admin2'),
        body: { year: 2031 },
      });

      expect([mine.status, theirs.status]).toEqual([201, 201]);
      expect(theirs.headers['idempotency-replayed']).toBeUndefined();
      expect(w.world.cycles.map((c) => [c.year, c.createdBy])).toEqual([
        [2030, w.admin.id],
        [2031, w.admin2.id],
      ]);
    });

    it('a malformed key is 400 on the Idempotency-Key field and nothing is created', async () => {
      const res = await w.send('post', '/cycles', {
        key: 'not valid!',
        body: { year: 2027 },
      });

      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual([['Idempotency-Key', 'INVALID']]);
      expect(w.world.cycles).toHaveLength(0);
    });

    it('without a key the route is untouched: no replay header, and the repeat is the plain 409', async () => {
      const first = await w.send('post', '/cycles', { body: { year: 2027 } });
      const second = await w.send('post', '/cycles', { body: { year: 2027 } });

      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expectError(second, 409, 'CYCLES_YEAR_TAKEN');
      expect(second.headers['idempotency-replayed']).toBeUndefined();
      expect(w.db.idempotency).toHaveLength(0);
    });

    it('a key left executed without an answer (the crash window) replays a fresh Cycle, not a stored copy', async () => {
      const first = await w.send('post', '/cycles', {
        key: 'crash-1',
        body: { year: 2027 },
      });
      const id = first.body.data.id as number;
      // The cycle was activated after the first answer was given.
      await activateCycle(id);
      // The process died after the commit and before the answer was stored.
      const row = w.idempotency.peek(w.admin.id, 'crash-1')!;
      w.idempotency.seed({
        ...row,
        state: 'executed',
        responseStatus: null,
        responseBody: null,
      });

      const replay = await w.send('post', '/cycles', {
        key: 'crash-1',
        body: { year: 2027 },
      });

      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toMatchObject({
        id,
        year: 2027,
        name: '2027 cycle',
        status: 'active',
      });
      expect(w.world.cycles).toHaveLength(1);
    });
  });

  // --- NFR-7: one decision line per write, no names or bodies ------------------

  describe('NFR-7: the decision line', () => {
    it('every write logs exactly one line with ids and fixed words, and no body reaches any log', async () => {
      const created = await w.send('post', '/cycles', { body: { year: 2037 } });
      const duplicate = await w.send('post', '/cycles', {
        body: { year: 2037 },
      });
      const second = await w.send('post', '/cycles', { body: { year: 2038 } });
      const activated = await w.send('post', '/cycles/1/activate');
      const refused = await w.send('post', '/cycles/1/activate');

      const lineOf = (res: request.Response) =>
        spy.eventsOf('admin_config', res.headers['x-request-id'] as string);
      const base = { event: 'admin_config', actorId: w.admin.id };
      expect(lineOf(created)).toEqual([
        {
          ...base,
          action: 'cycle_create',
          targetId: 1,
          outcome: 'ok',
          requestId: created.headers['x-request-id'],
          idempotency: 'none',
        },
      ]);
      expect(lineOf(duplicate)).toMatchObject([
        {
          action: 'cycle_create',
          outcome: 'refused',
          reason: 'CYCLES_YEAR_TAKEN',
        },
      ]);
      expect(lineOf(second)).toMatchObject([
        {
          action: 'cycle_create',
          targetId: second.body.data.id,
          outcome: 'ok',
        },
      ]);
      expect(lineOf(activated)).toMatchObject([
        { action: 'cycle_activate', targetId: 1, outcome: 'ok' },
      ]);
      expect(lineOf(refused)).toMatchObject([
        {
          action: 'cycle_activate',
          outcome: 'refused',
          reason: 'CYCLES_NOT_DRAFT',
        },
      ]);
      // No sink carries the request body or the display name.
      expect(spy.lines.filter((l) => l.includes('"year"'))).toEqual([]);
      expect(spy.lines.filter((l) => l.includes(' cycle'))).toEqual([]);
    });
  });

  // --- OpenAPI ----------------------------------------------------------------

  describe('OpenAPI', () => {
    it('documents the three routes: the key header on create only, the codes each can answer, the Cycle model', () => {
      const doc = buildOpenApiDocument(w.app);
      const paths = doc.paths as Record<string, Record<string, any>>;
      const create = paths['/api/v1/cycles']!.post;
      const list = paths['/api/v1/cycles']!.get;
      const activate = paths['/api/v1/cycles/{id}/activate']!.post;

      expect(create.summary).toBeTruthy();
      expect(Object.keys(create.responses)).toEqual(
        expect.arrayContaining(['201', '400', '401', '403', '409', '422']),
      );
      expect(create.parameters.map((p: { name: string }) => p.name)).toContain(
        'Idempotency-Key',
      );
      expect(
        create.responses['201'].headers['Idempotency-Replayed'],
      ).toBeDefined();
      expect(Object.keys(list.responses)).toEqual(
        expect.arrayContaining(['200', '401', '403']),
      );
      expect(Object.keys(activate.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
      );
      expect(
        (activate.parameters ?? []).map((p: { name: string }) => p.name),
      ).not.toContain('Idempotency-Key');
      const schemas = doc.components?.schemas as Record<string, any>;
      expect(schemas.CycleModel.required).toEqual(
        expect.arrayContaining([
          'id',
          'year',
          'name',
          'status',
          'timelineCount',
          'startsOn',
          'endsOn',
          'createdAt',
        ]),
      );
      expect(schemas.CreateCycleDto.properties.year).toMatchObject({
        type: 'number',
        minimum: 2020,
        maximum: 2100,
      });
    });
  });
});
