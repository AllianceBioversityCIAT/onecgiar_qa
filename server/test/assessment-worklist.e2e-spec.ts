// @akili-spec assessment/step-1-assessment
import type { OpenAPIObject } from '@nestjs/swagger';
import type request from 'supertest';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import {
  defaultFakeSteps,
  type FakeMembership,
} from './support/in-memory-assessment.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';

// The worklist routes over real HTTP (design 6, first three rows; FR-1, FR-3,
// FR-7, FR-22). Guards, validation pipe, envelope and OpenAPI are the real
// ones; only the stores, catalogs and clock are fakes. Expected values are
// written out, not imported.

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

let nextMembership = 1;
function membership(
  resultCode: number,
  extra: Partial<FakeMembership> = {},
): FakeMembership {
  return {
    id: nextMembership++,
    timelineId: 1,
    resultCode,
    title: `Result ${resultCode}`,
    programId: 1,
    resultTypeKey: 'KP',
    ...extra,
  };
}

describe('Worklist routes (e2e)', () => {
  let a: AssessmentApp;

  beforeEach(async () => {
    a = await buildAssessmentApp();
    a.world.timelines.push(
      { id: 1, name: 'Official', kind: 'official', steps: defaultFakeSteps() },
      {
        id: 2,
        name: 'Additional',
        kind: 'additional',
        steps: defaultFakeSteps(),
      },
      {
        id: 3,
        name: 'Draft cycle',
        kind: 'official',
        cycleStatus: 'draft',
        steps: defaultFakeSteps(),
      },
    );
    // The assessor is assigned to timeline 1 only; the admin to none.
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.assessor.id,
      roleCode: 'ASSESSOR',
    });
  });

  afterEach(async () => {
    await a.app.close();
  });

  describe('FR-22: every route requires authentication', () => {
    it.each([
      '/worklist/timelines',
      '/timelines/1/worklist',
      '/timelines/1/worklist/options',
    ])('GET %s: 401 without a token', async (path) => {
      const res = await a.send('get', path, { token: null });
      expectError(res, 401, 'AUTH_TOKEN_INVALID');
    });

    it('401 for a malformed token', async () => {
      const res = await a.send('get', '/timelines/1/worklist', {
        token: 'Bearer not-a-token',
      });
      expectError(res, 401, 'AUTH_TOKEN_INVALID');
    });
  });

  describe('GET /worklist/timelines (FR-3)', () => {
    it('answers the envelope with the timelines the caller is assigned to, the default and the time zone', async () => {
      // A step that requires a load opens only once the timeline holds one.
      a.world.memberships.push(membership(101));
      const res = await a.send('get', '/worklist/timelines');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
      });
      expect(typeof res.body.meta.timestamp).toBe('string');
      expect(res.body.meta.page).toBeUndefined();
      expect(res.body.data).toEqual({
        timelines: [
          {
            id: 1,
            name: 'Official',
            kind: 'official',
            roles: ['ASSESSOR'],
            step: {
              position: 1,
              name: 'Step 1',
              opensAt: '2026-03-01T00:00',
              closesAt: '2026-03-31T23:59',
              state: 'in_progress',
            },
          },
        ],
        defaultTimelineId: 1,
        timeZone: 'Europe/Rome',
      });
    });

    it('an ADMIN is offered every timeline of the active cycle, with the role ADMIN', async () => {
      const res = await a.send('get', '/worklist/timelines', {
        token: bearer('sub-admin'),
      });
      expect(res.status).toBe(200);
      expect(
        res.body.data.timelines.map((t: { id: number; roles: string[] }) => [
          t.id,
          t.roles,
        ]),
      ).toEqual([
        [1, ['ADMIN']],
        [2, ['ADMIN']],
      ]);
    });

    it('a caller with no assignment gets an empty list, not an error', async () => {
      const res = await a.send('get', '/worklist/timelines', {
        token: bearer('sub-other'),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.timelines).toEqual([]);
      expect(res.body.data.defaultTimelineId).toBeNull();
    });
  });

  describe('GET /timelines/:timelineId/worklist', () => {
    it('answers rows, counters (with the total) and writable in data, and the cursor in meta.page', async () => {
      a.world.memberships.push(
        membership(101),
        membership(102),
        membership(103, { programId: 2 }),
      );
      const res = await a.send('get', '/timelines/1/worklist');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: {
          requestId: res.headers['x-request-id'],
          page: { nextCursor: null },
        },
      });
      expect(Object.keys(res.body.data).sort()).toEqual([
        'counters',
        'noActiveRole',
        'rows',
        'writable',
      ]);
      expect(res.body.data.counters).toEqual({
        pending: 3,
        finished: 0,
        total: 3,
      });
      expect(res.body.data.writable).toBe(true);
      expect(res.body.data.noActiveRole).toBe(false);
      expect(
        res.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([101, 102, 103]);
      expect(res.body.data.rows[0]).toEqual({
        membershipId: expect.any(Number),
        resultCode: 101,
        title: 'Result 101',
        updated: false,
        program: { id: 1, code: 'SP01', name: 'Breeding' },
        resultType: { key: 'KP', label: 'Knowledge product' },
        comments: 0,
        answeredBySp: 0,
        assessedBy: null,
        status: 'pending',
        canOpen: true,
        readOnlyReason: null,
      });
    });

    it('pages with meta.page.nextCursor until it is null', async () => {
      a.world.memberships.push(
        ...[101, 102, 103, 104, 105].map((code) => membership(code)),
      );
      const first = await a.send('get', '/timelines/1/worklist?limit=2');
      expect(first.status).toBe(200);
      expect(
        first.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([101, 102]);
      const cursor = first.body.meta.page.nextCursor as string;
      expect(typeof cursor).toBe('string');
      // The counters do not depend on the page (FR-7).
      expect(first.body.data.counters.total).toBe(5);

      const second = await a.send(
        'get',
        `/timelines/1/worklist?limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(
        second.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([103, 104]);
      const last = await a.send(
        'get',
        `/timelines/1/worklist?limit=2&cursor=${encodeURIComponent(
          second.body.meta.page.nextCursor,
        )}`,
      );
      expect(
        last.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([105]);
      expect(last.body.meta.page.nextCursor).toBeNull();
    });

    it('limit defaults to 25 and accepts 1 and 100', async () => {
      a.world.memberships.push(
        ...Array.from({ length: 30 }, (_, i) => membership(200 + i)),
      );
      const byDefault = await a.send('get', '/timelines/1/worklist');
      expect(byDefault.body.data.rows).toHaveLength(25);
      expect(byDefault.body.meta.page.nextCursor).not.toBeNull();
      const one = await a.send('get', '/timelines/1/worklist?limit=1');
      expect(one.body.data.rows).toHaveLength(1);
      const hundred = await a.send('get', '/timelines/1/worklist?limit=100');
      expect(hundred.body.data.rows).toHaveLength(30);
      expect(hundred.body.meta.page.nextCursor).toBeNull();
    });

    it.each(['0', '101', '-1', 'abc', '2.5'])(
      'limit=%s: 400 VALIDATION_FAILED on limit',
      async (limit) => {
        a.world.memberships.push(membership(101));
        const res = await a.send('get', `/timelines/1/worklist?limit=${limit}`);
        expectError(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.fields).toEqual([
          expect.objectContaining({ field: 'limit' }),
        ]);
      },
    );

    it('a cursor that is not ours: 400 VALIDATION_FAILED on cursor', async () => {
      const res = await a.send('get', '/timelines/1/worklist?cursor=garbage');
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
        expect.objectContaining({ field: 'cursor' }),
      ]);
    });

    it.each([
      ['sort=nope', 'sort'],
      ['dir=sideways', 'dir'],
      ['status=pending,bogus', 'status'],
      ['programId=x', 'programId'],
      ['programId=1,0', 'programId'],
    ])('%s: 400 VALIDATION_FAILED on %s', async (query, field) => {
      const res = await a.send('get', `/timelines/1/worklist?${query}`);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
        expect.objectContaining({ field }),
      ]);
    });

    it('an unknown query parameter is a 400 UNKNOWN_FIELD', async () => {
      const res = await a.send('get', '/timelines/1/worklist?scope=all');
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
        expect.objectContaining({ field: 'scope', code: 'UNKNOWN_FIELD' }),
      ]);
    });

    it('a timeline id that is not a positive integer is a 400, never a lookup', async () => {
      const res = await a.send('get', '/timelines/abc/worklist');
      expectError(res, 400, 'VALIDATION_FAILED');
    });

    it('filters by csv status, programId and resultTypeKey, and sorts', async () => {
      a.world.memberships.push(
        membership(101, { programId: 1, resultTypeKey: 'KP' }),
        membership(102, { programId: 2, resultTypeKey: 'KP' }),
        membership(103, { programId: 3, resultTypeKey: 'KP' }),
        membership(104, { programId: 1, resultTypeKey: 'POLICY' }),
      );
      const byProgram = await a.send(
        'get',
        '/timelines/1/worklist?programId=1,2&status=pending&resultTypeKey=KP&sort=code&dir=desc',
      );
      expect(byProgram.status).toBe(200);
      expect(
        byProgram.body.data.rows.map(
          (r: { resultCode: number }) => r.resultCode,
        ),
      ).toEqual([102, 101]);
      const search = await a.send('get', '/timelines/1/worklist?q=Result 10');
      expect(search.status).toBe(200);
    });

    it('an unassigned timeline is a 404 TIMELINES_NOT_FOUND, byte-equal to a missing one', async () => {
      a.world.memberships.push(membership(301, { timelineId: 2 }));
      const unassigned = await a.send('get', '/timelines/2/worklist');
      const missing = await a.send('get', '/timelines/999/worklist');
      expectError(unassigned, 404, 'TIMELINES_NOT_FOUND');
      expectError(missing, 404, 'TIMELINES_NOT_FOUND');
      expect(unassigned.body.error).toEqual(missing.body.error);
      expect(JSON.stringify(unassigned.body)).not.toContain('301');
    });

    it('a caller assigned to no timeline gets 404 on timeline 1', async () => {
      a.world.memberships.push(membership(101));
      const res = await a.send('get', '/timelines/1/worklist', {
        token: bearer('sub-other'),
      });
      expectError(res, 404, 'TIMELINES_NOT_FOUND');
    });

    it('a timeline of a cycle that is not active is a 404', async () => {
      a.world.timelineUsers.push({
        timelineId: 3,
        userId: a.users.assessor.id,
        roleCode: 'ASSESSOR',
      });
      const res = await a.send('get', '/timelines/3/worklist');
      expectError(res, 404, 'TIMELINES_NOT_FOUND');
    });

    it('an ADMIN reads any timeline of the active cycle, read-only', async () => {
      a.world.memberships.push(membership(301, { timelineId: 2 }));
      const res = await a.send('get', '/timelines/2/worklist', {
        token: bearer('sub-admin'),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toHaveLength(1);
      expect(res.body.data.writable).toBe(false);
    });
  });

  describe('GET /timelines/:timelineId/worklist/options', () => {
    it('lists the programs, result types and statuses inside the caller scope', async () => {
      const res = await a.send('get', '/timelines/1/worklist/options');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.programs).toEqual([
        { id: 1, code: 'SP01', name: 'Breeding' },
        { id: 2, code: 'SP02', name: 'Multifunctional landscapes' },
        { id: 3, code: 'SP03', name: 'Climate action' },
      ]);
      // The assessor is granted result type KP only.
      expect(res.body.data.resultTypes).toEqual([
        { key: 'KP', label: 'Knowledge product' },
      ]);
      expect(res.body.data.statuses).toEqual(
        expect.arrayContaining([
          { key: 'pending', label: 'Pending' },
          { key: 'auto_validated', label: 'Auto-validated' },
        ]),
      );
    });

    it('a program outside the caller program scope is not listed', async () => {
      await a.programScope(a.users.assessor.id, [2]);
      const res = await a.send('get', '/timelines/1/worklist/options');
      expect(res.body.data.programs).toEqual([
        { id: 2, code: 'SP02', name: 'Multifunctional landscapes' },
      ]);
    });

    it('an unassigned timeline is a 404 TIMELINES_NOT_FOUND', async () => {
      const res = await a.send('get', '/timelines/2/worklist/options');
      expectError(res, 404, 'TIMELINES_NOT_FOUND');
    });
  });

  describe('OpenAPI listing', () => {
    let doc: OpenAPIObject;
    beforeEach(() => {
      doc = buildOpenApiDocument(a.app);
    });

    it('documents the three routes, bearer-protected, with 401 and the 404 code', () => {
      for (const path of [
        '/api/v1/worklist/timelines',
        '/api/v1/timelines/{timelineId}/worklist',
        '/api/v1/timelines/{timelineId}/worklist/options',
      ]) {
        const item = doc.paths[path] as Record<string, any> | undefined;
        expect(item, path).toBeDefined();
        const op = item!.get;
        expect(op.summary, path).toBeTruthy();
        expect(JSON.stringify(op.security), path).toContain('access-token');
        expect(Object.keys(op.responses), path).toEqual(
          expect.arrayContaining(['200', '401']),
        );
      }
      const list = (doc.paths['/api/v1/timelines/{timelineId}/worklist'] as any)
        .get;
      expect(Object.keys(list.responses)).toEqual(
        expect.arrayContaining(['400', '404']),
      );
      expect(list.responses['404'].description).toContain(
        'TIMELINES_NOT_FOUND',
      );
      const queryNames = list.parameters
        .filter((p: { in: string }) => p.in === 'query')
        .map((p: { name: string }) => p.name)
        .sort();
      expect(queryNames).toEqual([
        'cursor',
        'dir',
        'limit',
        'programId',
        'q',
        'resultTypeKey',
        'sort',
        'status',
      ]);
    });

    it('describes counters.total and that roles can include ADMIN', () => {
      const schemas = doc.components?.schemas as Record<string, any>;
      expect(schemas.WorklistCountersModel.required).toEqual(
        expect.arrayContaining(['pending', 'finished', 'total']),
      );
      expect(
        schemas.WorklistTimelineModel.properties.roles.description,
      ).toMatch(/ADMIN/);
      expect(schemas.WorklistPageModel.required).toEqual(
        expect.arrayContaining(['rows', 'counters', 'writable']),
      );
    });
  });
});
