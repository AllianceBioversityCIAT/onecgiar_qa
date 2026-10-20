import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { CognitoAdminClient } from '../src/auth/cognito-admin.client.js';
import { UpstreamUnavailableError } from '../src/auth/cognito-auth.client.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_STORE,
} from '../src/common/idempotency/idempotency.store.js';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../src/users/catalogs/catalogs.ports.js';
import { CurrentUserCache } from '../src/users/current-user.cache.js';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import { ROLE_ASSIGNMENTS_STORE } from '../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../src/users/user-programs.repository.js';
import { USERS_ADMIN_UNIT_OF_WORK } from '../src/users/users-admin.unit-of-work.js';
import { USERS_QUERY_STORE } from '../src/users/users-query.repository.js';
import { USERS_STORE } from '../src/users/users.repository.js';
import { roundTrip } from './support/in-memory-idempotency.js';
import { InMemoryUsersQueryStore } from './support/in-memory-query-store.js';
import {
  localJwksCache,
  newKeyPair,
  signJwt,
} from './support/jwt-test-keys.js';
import {
  adminWorld,
  PROGRAMS,
  RESULT_TYPES,
} from './support/users-admin-world.js';

// users-admin-write-safety T-6 over the real app: every users-admin write
// route is idempotent over HTTP (FR-1…FR-6, FR-10). The guards, the pipe, the
// filter, the interceptor and the response envelope are real; the stores, the
// key store, Cognito and the catalogs are the in-memory world. The fake unit of
// work is the recording one, so a request can be held in its transaction.
// Expected values are the spec's, written out as literals. Every replay test
// asserts the REAL status code, the `data` and the side-effect counters; a
// status alone would pass on a handler that ran twice.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('users-admin-idempotency-kid');
const now = () => Math.floor(Date.now() / 1000);

const bearer = (sub: string) =>
  `Bearer ${signJwt(
    {
      sub,
      iss: ISSUER,
      client_id: process.env.COGNITO_CLIENT_ID,
      token_use: 'access',
      scope: 'aws.cognito.signin.user.admin',
      username: sub,
      auth_time: now(),
      iat: now(),
      exp: now() + 3600,
      jti: `jti-${sub}`,
    },
    signer,
  )}`;

type Method = 'post' | 'put' | 'patch' | 'delete';
interface Req {
  method: Method;
  path: string;
  body?: object;
}
/** A request, and a different one for the "same key, other request" case. */
interface Plan extends Req {
  other: Req;
}

/** What one execution changes, counted from the outside. */
interface Effects {
  users: number;
  audit: number;
  invalidations: number;
  cognitoCreate: number;
  cognitoResend: number;
}
const NONE: Effects = {
  users: 0,
  audit: 0,
  invalidations: 0,
  cognitoCreate: 0,
  cognitoResend: 0,
};

const NON_ADMINS = [
  'ASSESSOR',
  'LEAD_ASSESSOR',
  'TPB',
  'PPU',
  'GUEST',
  'MULTI_GRANT',
] as const;

async function build() {
  const w = adminWorld();
  const actor = async (
    sub: string,
    roles: Array<[string, string?]>,
    nickname?: string,
  ) => {
    const user = await w.users.create({
      email: `${sub}@cgiar.org`,
      cognitoSub: sub,
      firstName: sub,
      lastName: 'Actor',
      authSource: 'sso',
      nickname: nickname ?? null,
    });
    for (const [roleCode, resultTypeKey] of roles) {
      await w.assignments.create({
        userId: user.id,
        roleCode,
        resultTypeKey: resultTypeKey ?? null,
      });
    }
    return user;
  };
  const admin = await actor('sub-admin', [['ADMIN']], 'Ada');
  const admin2 = await actor('sub-admin2', [['ADMIN']], 'Bea');
  await actor('sub-assessor', [['ASSESSOR', 'KP']]);
  await actor('sub-lead_assessor', [['LEAD_ASSESSOR', '*']]);
  await actor('sub-multi_grant', [['ASSESSOR', 'KP'], ['TPB']]);
  await actor('sub-tpb', [['TPB']]);
  await actor('sub-ppu', [['PPU']]);
  await actor('sub-guest', []);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USERS_STORE)
    .useValue(w.db.stores.users)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(w.db.stores.assignments)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(w.db.stores.programs)
    .overrideProvider(USERS_ADMIN_UNIT_OF_WORK)
    .useValue(w.unitOfWork)
    .overrideProvider(USERS_QUERY_STORE)
    .useValue(new InMemoryUsersQueryStore(w.db))
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(w.idempotency)
    .overrideProvider(IDEMPOTENCY_CLOCK)
    .useValue(w.clock.now)
    .overrideProvider(CognitoAdminClient)
    .useValue(w.cognito)
    .overrideProvider(RESULT_TYPE_SOURCE)
    .useValue({ list: async () => RESULT_TYPES })
    .overrideProvider(SCIENCE_PROGRAM_SOURCE)
    .useValue({ list: async () => PROGRAMS })
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  const invalidate = vi.spyOn(app.get(CurrentUserCache), 'invalidate');
  return {
    ...w,
    app,
    admin,
    admin2,
    invalidate,
    adminToken: bearer('sub-admin'),
    admin2Token: bearer('sub-admin2'),
  };
}
type World = Awaited<ReturnType<typeof build>>;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

describe('Users admin idempotency (e2e)', () => {
  let w: World;
  let serial = 0;

  // One app for the whole file: every test seeds its own people and keys, so
  // nothing carries over, and the 11-route tables stay fast.
  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    w = await build();
  });
  afterAll(async () => {
    await w.app.close();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    w.unitOfWork.beforeMark = undefined;
    w.idempotency.failNext(undefined as never);
  });

  const send = (
    req: Req,
    key?: string,
    token: string | null = w.adminToken,
  ) => {
    const call = request(w.app.getHttpServer())[req.method](
      `/api/v1${req.path}`,
    );
    if (token !== null) call.set('Authorization', token);
    if (key !== undefined) call.set('Idempotency-Key', key);
    return req.body === undefined ? call : call.send(req.body);
  };
  const newKey = (label: string) => `e2e-${label}-${++serial}`;

  const effects = (): Effects => ({
    users: w.db.users.length,
    audit: w.db.audit.length,
    invalidations: w.invalidate.mock.calls.length,
    cognitoCreate: w.cognito.createUser.mock.calls.length,
    cognitoResend: w.cognito.resendInvitation.mock.calls.length,
  });
  /** What happened since `before`, as a full record (a missing count is a 0). */
  const since = (before: Effects): Effects => {
    const after = effects();
    return {
      users: after.users - before.users,
      audit: after.audit - before.audit,
      invalidations: after.invalidations - before.invalidations,
      cognitoCreate: after.cognitoCreate - before.cognitoCreate,
      cognitoResend: after.cognitoResend - before.cognitoResend,
    };
  };
  const storedRows = () => w.db.idempotency.length;

  const person = (over: Partial<Parameters<World['seedUser']>[0]> = {}) => {
    const i = ++serial;
    return w.seedUser({
      email: `person${i}@cgiar.org`,
      nickname: `Person ${i}`,
      invitation: 'sent',
      roles: [['TPB']],
      ...over,
    });
  };
  const manualExclusion = async (userId: number, programId: number) => {
    await w.programs.addManualExclusion({
      userId,
      programId,
      reason: 'Co-author',
      createdBy: w.admin.id,
    });
    return w.db.exclusions.at(-1)!.id;
  };
  const reportingExclusion = async (userId: number, programId: number) => {
    await w.db.stores.programs.insertExclusion({
      userId,
      programId,
      origin: 'reporting',
      reportingRole: 'Lead',
      createdBy: null,
    });
    return w.db.exclusions.at(-1)!.id;
  };

  function expectError(res: request.Response, status: number, code: string) {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({
      success: false,
      error: { status, code },
      meta: { requestId: res.headers['x-request-id'] },
    });
  }
  const fieldsOf = (res: request.Response) =>
    (res.body.error.fields as Array<{ field: string; code: string }>).map(
      ({ field, code }) => [field, code],
    );

  // --- the 11 keyed routes ---------------------------------------------------

  interface Row {
    name: string;
    /** The success status, written out (201 where the route creates). */
    status: 200 | 201;
    plan: () => Promise<Plan>;
    /** One execution, counted from the outside (design 7 / core DD-15). */
    first: Partial<Effects>;
    /** The same request run a second time as a fresh execution (no key, or another admin). */
    again: { status: number; code?: string; effects: Partial<Effects> };
  }

  const ROWS: Row[] = [
    {
      name: 'POST /users',
      status: 201,
      plan: async () => {
        const i = ++serial;
        const body = {
          email: `Created${i}@cgiar.org`,
          firstName: 'New',
          lastName: 'Person',
          nickname: `Created ${i}`,
          accountType: 'custom',
        };
        return {
          method: 'post',
          path: '/users',
          body,
          other: {
            method: 'post',
            path: '/users',
            body: { ...body, email: `other${i}@cgiar.org` },
          },
        };
      },
      // A new user has no cache entry to invalidate.
      first: { users: 1, audit: 1, cognitoCreate: 1 },
      again: { status: 409, code: 'USERS_EMAIL_TAKEN', effects: {} },
    },
    {
      name: 'PATCH /users/:id',
      status: 200,
      plan: async () => {
        const [a, b] = [await person(), await person()];
        return {
          method: 'patch',
          path: `/users/${a.id}`,
          body: { nickname: `Renamed ${a.id}` },
          other: {
            method: 'patch',
            path: `/users/${b.id}`,
            body: { nickname: `Renamed ${b.id}` },
          },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
    {
      name: 'PUT /users/:id/roles',
      status: 200,
      plan: async () => {
        const a = await person();
        return {
          method: 'put',
          path: `/users/${a.id}/roles`,
          body: { roles: [{ role: 'PPU' }] },
          other: {
            method: 'put',
            path: `/users/${a.id}/roles`,
            body: { roles: [{ role: 'TPB' }, { role: 'PPU' }] },
          },
        };
      },
      // TPB revoked, PPU granted: one audit row each (core DD-15).
      first: { audit: 2, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
    {
      name: 'PUT /users/:id/programs',
      status: 200,
      plan: async () => {
        const a = await person();
        return {
          method: 'put',
          path: `/users/${a.id}/programs`,
          body: { programs: [1, 2] },
          other: {
            method: 'put',
            path: `/users/${a.id}/programs`,
            body: { programs: [1, 3] },
          },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
    {
      name: 'POST /users/:id/exclusions',
      status: 201,
      plan: async () => {
        const a = await person();
        return {
          method: 'post',
          path: `/users/${a.id}/exclusions`,
          body: { programId: 1, reason: 'Co-author' },
          other: {
            method: 'post',
            path: `/users/${a.id}/exclusions`,
            body: { programId: 2, reason: 'Co-author' },
          },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 409, code: 'USERS_EXCLUSION_EXISTS', effects: {} },
    },
    {
      name: 'DELETE /users/:id/exclusions/:exclusionId',
      status: 200,
      plan: async () => {
        const a = await person();
        const [one, two] = [
          await manualExclusion(a.id, 1),
          await manualExclusion(a.id, 2),
        ];
        return {
          method: 'delete',
          path: `/users/${a.id}/exclusions/${one}`,
          other: { method: 'delete', path: `/users/${a.id}/exclusions/${two}` },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 404, code: 'USERS_EXCLUSION_NOT_FOUND', effects: {} },
    },
    {
      name: 'POST /users/:id/exclusions/:exclusionId/dismiss',
      status: 200,
      plan: async () => {
        const a = await person();
        const [one, two] = [
          await reportingExclusion(a.id, 2),
          await reportingExclusion(a.id, 3),
        ];
        const body = { reason: 'Not a conflict' };
        return {
          method: 'post',
          path: `/users/${a.id}/exclusions/${one}/dismiss`,
          body,
          other: {
            method: 'post',
            path: `/users/${a.id}/exclusions/${two}/dismiss`,
            body,
          },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 404, code: 'USERS_EXCLUSION_NOT_FOUND', effects: {} },
    },
    {
      name: 'POST /users/:id/deactivate',
      status: 200,
      plan: async () => {
        const [a, b] = [await person(), await person()];
        return {
          method: 'post',
          path: `/users/${a.id}/deactivate`,
          other: { method: 'post', path: `/users/${b.id}/deactivate` },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
    {
      name: 'POST /users/:id/activate',
      status: 200,
      plan: async () => {
        const [a, b] = [
          await person({ isActive: false }),
          await person({ isActive: false }),
        ];
        return {
          method: 'post',
          path: `/users/${a.id}/activate`,
          other: { method: 'post', path: `/users/${b.id}/activate` },
        };
      },
      first: { audit: 1, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
    {
      name: 'POST /users/:id/invitation',
      status: 200,
      plan: async () => {
        const [a, b] = [await person(), await person()];
        return {
          method: 'post',
          path: `/users/${a.id}/invitation`,
          other: { method: 'post', path: `/users/${b.id}/invitation` },
        };
      },
      // Today a second run sends a second email: that is the defect (C4).
      first: { audit: 1, cognitoResend: 1, invalidations: 1 },
      again: {
        status: 200,
        effects: { audit: 1, cognitoResend: 1, invalidations: 1 },
      },
    },
    {
      name: 'PUT /users/:id',
      status: 200,
      plan: async () => {
        const a = await person();
        const body = {
          nickname: `Saved ${a.id}`,
          roles: [{ role: 'PPU' }],
          programs: [1],
          exclusions: [],
        };
        return {
          method: 'put',
          path: `/users/${a.id}`,
          body,
          other: {
            method: 'put',
            path: `/users/${a.id}`,
            body: { ...body, nickname: `Saved again ${a.id}` },
          },
        };
      },
      // edit 1 + roles 2 (TPB revoked, PPU granted) + programs 1, one invalidation.
      first: { audit: 4, invalidations: 1 },
      again: { status: 200, effects: {} },
    },
  ];

  it('has a 403 row for every grantable role (a new role without one fails here)', () => {
    const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
    for (const { code } of GRANTABLE_ROLES) {
      expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
    }
  });

  it('covers exactly the 11 keyed write routes', () => {
    expect(ROWS.map((row) => row.name).sort()).toEqual(
      [
        'DELETE /users/:id/exclusions/:exclusionId',
        'PATCH /users/:id',
        'POST /users',
        'POST /users/:id/activate',
        'POST /users/:id/deactivate',
        'POST /users/:id/exclusions',
        'POST /users/:id/exclusions/:exclusionId/dismiss',
        'POST /users/:id/invitation',
        'PUT /users/:id',
        'PUT /users/:id/programs',
        'PUT /users/:id/roles',
      ].sort(),
    );
  });

  describe.each(ROWS)('$name', (row) => {
    it('same key twice: one side effect; the second answer is the first data, marked as replayed, with the real status (FR-2, FR-3)', async () => {
      const plan = await row.plan();
      const key = newKey('twice');
      const before = effects();

      const first = await send(plan, key);
      expect(first.status).toBe(row.status);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(since(before)).toEqual({ ...NONE, ...row.first });
      const afterFirst = effects();

      const second = await send(plan, key);
      // Nothing ran again: no row, no email, no account, no cache call.
      expect(effects()).toEqual(afterFirst);
      expect(second.status).toBe(row.status);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(second.body.success).toBe(true);
      expect(second.body.data).toEqual(first.body.data);
      expect(second.body.meta.requestId).toBe(second.headers['x-request-id']);
      expect(second.body.meta.requestId).not.toBe(first.body.meta.requestId);
    });

    it('no header twice: each request runs as today and nothing is remembered (FR-1)', async () => {
      const plan = await row.plan();
      const rows = storedRows();
      const before = effects();

      const first = await send(plan);
      expect(first.status).toBe(row.status);
      expect(since(before)).toEqual({ ...NONE, ...row.first });
      const afterFirst = effects();

      const second = await send(plan);
      expect(second.status).toBe(row.again.status);
      if (row.again.code !== undefined) {
        expectError(second, row.again.status, row.again.code);
      }
      expect(since(afterFirst)).toEqual({ ...NONE, ...row.again.effects });
      for (const res of [first, second]) {
        expect(res.headers['idempotency-replayed']).toBeUndefined();
      }
      expect(storedRows()).toBe(rows);
    });

    it('same key, a different request: 422 IDEMPOTENCY_KEY_REUSED and nothing runs (FR-4)', async () => {
      const plan = await row.plan();
      const key = newKey('reuse');
      const first = await send(plan, key);
      expect(first.status).toBe(row.status);
      const afterFirst = effects();

      const reused = await send(plan.other, key);
      expectError(reused, 422, 'IDEMPOTENCY_KEY_REUSED');
      expect(reused.headers['idempotency-replayed']).toBeUndefined();
      expect(effects()).toEqual(afterFirst);
      // The key still holds the first request's answer.
      const replay = await send(plan, key);
      expect(replay.status).toBe(row.status);
      expect(replay.body.data).toEqual(first.body.data);
    });

    it('same key while the first request is in flight: 409 IDEMPOTENCY_IN_PROGRESS, then exactly one execution (FR-5)', async () => {
      const plan = await row.plan();
      const key = newKey('flight');
      const reached = deferred();
      const gate = deferred();
      // The first request stops inside its transaction, right before the mark.
      w.unitOfWork.beforeMark = async () => {
        reached.resolve();
        await gate.promise;
      };
      const before = effects();
      const firstCall = send(plan, key).then((res) => res);
      await reached.promise;
      const atGate = effects();

      const second = await send(plan, key);
      expectError(second, 409, 'IDEMPOTENCY_IN_PROGRESS');
      expect(effects()).toEqual(atGate);

      gate.resolve();
      const first = await firstCall;
      expect(first.status).toBe(row.status);
      expect(since(before)).toEqual({ ...NONE, ...row.first });
      const replay = await send(plan, key);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(first.body.data);
    });

    it('another admin with the same key gets a fresh execution, never the first admin body (FR-6)', async () => {
      const plan = await row.plan();
      const key = newKey('admins');
      const first = await send(plan, key);
      expect(first.status).toBe(row.status);
      const afterFirst = effects();

      const second = await send(plan, key, w.admin2Token);
      expect(second.headers['idempotency-replayed']).toBeUndefined();
      expect(second.status).toBe(row.again.status);
      if (row.again.code !== undefined) {
        expectError(second, row.again.status, row.again.code);
        expect(second.body.data).toBeUndefined();
      }
      expect(since(afterFirst)).toEqual({ ...NONE, ...row.again.effects });
      // Two rows, one per admin, and the first admin's answer is untouched.
      const owners = w.db.idempotency
        .filter((stored) => stored.idemKey === key)
        .map((stored) => stored.actorId)
        .sort((a, b) => a - b);
      expect(owners).toEqual([w.admin.id, w.admin2.id].sort((a, b) => a - b));
      const replay = await send(plan, key);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(first.body.data);
    });

    it('a 401 or a 403 with a key stores nothing and changes nothing (FR-6)', async () => {
      const plan = await row.plan();
      const key = newKey('refused');
      const rows = storedRows();
      const before = effects();

      expectError(await send(plan, key, null), 401, 'AUTH_TOKEN_INVALID');
      for (const role of NON_ADMINS) {
        expectError(
          await send(plan, key, bearer(`sub-${role.toLowerCase()}`)),
          403,
          'AUTH_PERMISSION_DENIED',
        );
      }
      expect(storedRows()).toBe(rows);
      expect(effects()).toEqual(before);
      // The key is still new for the admin: a fresh execution, not a replay.
      const real = await send(plan, key);
      expect(real.status).toBe(row.status);
      expect(real.headers['idempotency-replayed']).toBeUndefined();
    });

    it('a malformed key is a 400 on the Idempotency-Key field and nothing runs or is stored (FR-6)', async () => {
      const plan = await row.plan();
      const rows = storedRows();
      const before = effects();
      const cases: Array<[string, string]> = [
        ['', 'REQUIRED'],
        ['k'.repeat(129), 'TOO_LONG'],
        ['has space', 'INVALID'],
        ['slash/inside', 'INVALID'],
      ];
      for (const [value, code] of cases) {
        const res = await send(plan, value);
        expectError(res, 400, 'VALIDATION_FAILED');
        expect(fieldsOf(res), JSON.stringify(value)).toEqual([
          ['Idempotency-Key', code],
        ]);
      }
      expect(storedRows()).toBe(rows);
      expect(effects()).toEqual(before);
    });
  });

  it('allows the longest key and every character class of the pattern', async () => {
    const key = `${'aZ09-_.:'.repeat(16)}`;
    expect(key).toHaveLength(128);
    const user = await person();
    const res = await send(
      { method: 'post', path: `/users/${user.id}/activate` },
      key,
    );
    expect(res.status).toBe(200);
    expect(w.db.idempotency.some((stored) => stored.idemKey === key)).toBe(
      true,
    );
  });

  // --- FR-3: a remembered refusal replays, whatever changed since -----------

  describe('Replayed refusal (FR-3, D3)', () => {
    interface Refusal {
      name: string;
      plan: () => Promise<Req>;
      status: number;
      code: string;
      /** Changes the world after the refusal, so a real run would no longer be refused. */
      change?: () => Promise<void>;
    }
    const REFUSALS: Refusal[] = [
      {
        name: 'POST /users: 409 email taken',
        plan: async () => {
          const taken = await person();
          return {
            method: 'post',
            path: '/users',
            body: {
              email: taken.email,
              firstName: 'A',
              lastName: 'B',
              nickname: `Fresh ${++serial}`,
              accountType: 'custom',
            },
          };
        },
        status: 409,
        code: 'USERS_EMAIL_TAKEN',
      },
      {
        name: 'PATCH /users/:id: 409 nickname taken, then the holder is renamed',
        plan: async () => {
          const holder = await person();
          const user = await person();
          refusalHolder = holder.id;
          return {
            method: 'patch',
            path: `/users/${user.id}`,
            body: { nickname: holder.nickname },
          };
        },
        status: 409,
        code: 'USERS_NICKNAME_TAKEN',
        change: async () => {
          await w.users.update(refusalHolder, { nickname: `Freed ${serial}` });
        },
      },
      {
        name: 'PUT /users/:id/roles: 400 from the pipe',
        plan: async () => {
          const user = await person();
          return { method: 'put', path: `/users/${user.id}/roles`, body: {} };
        },
        status: 400,
        code: 'VALIDATION_FAILED',
      },
      {
        name: 'POST /users/:id/deactivate: 404 for a missing user',
        plan: async () => ({ method: 'post', path: '/users/99999/deactivate' }),
        status: 404,
        code: 'USERS_NOT_FOUND',
      },
      {
        name: 'PUT /users/:id: 409 role conflict, atomic',
        plan: async () => {
          const user = await person();
          return {
            method: 'put',
            path: `/users/${user.id}`,
            body: {
              roles: [
                { role: 'ASSESSOR', resultTypes: ['KP'] },
                { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
              ],
              programs: 'all',
              exclusions: [],
            },
          };
        },
        status: 409,
        code: 'USERS_ROLE_CONFLICT',
      },
    ];
    let refusalHolder = 0;

    it.each(REFUSALS)('$name', async (refusal) => {
      const req = await refusal.plan();
      const key = newKey('refusal');
      const before = effects();

      const first = await send(req, key);
      expectError(first, refusal.status, refusal.code);
      expect(effects()).toEqual(before);
      await refusal.change?.();

      const second = await send(req, key);
      expect(second.status).toBe(refusal.status);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(second.body.error).toEqual(first.body.error);
      expect(second.body.meta.requestId).not.toBe(first.body.meta.requestId);
      expect(effects()).toEqual(before);
      if (refusal.change !== undefined) {
        // The control: a new key now succeeds, so the replay really was the memory.
        const fresh = await send(req, newKey('control'));
        expect(fresh.status).toBe(200);
      }
    });
  });

  // --- D3: a server failure is not remembered; the store is never bypassed ----

  it('a 503 from Cognito is not remembered: the key is free and the retry runs (D3)', async () => {
    const i = ++serial;
    const create: Req = {
      method: 'post',
      path: '/users',
      body: {
        email: `retry${i}@cgiar.org`,
        firstName: 'R',
        lastName: 'T',
        nickname: `Retry ${i}`,
        accountType: 'custom',
      },
    };
    const key = newKey('retry');
    w.cognito.createUser.mockRejectedValueOnce(new UpstreamUnavailableError());
    const rows = storedRows();

    expectError(await send(create, key), 503, 'AUTH_SERVICE_UNAVAILABLE');
    expect(storedRows()).toBe(rows);
    const retry = await send(create, key);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBeUndefined();
    const replay = await send(create, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual(retry.body.data);
  });

  it('answers 503 and runs nothing when the key store is down (NFR-4)', async () => {
    const user = await person();
    const req: Req = { method: 'post', path: `/users/${user.id}/deactivate` };
    const before = effects();
    w.idempotency.failNext(new Error('db down'));

    expectError(await send(req, newKey('down')), 503, 'SERVICE_UNAVAILABLE');
    expect(effects()).toEqual(before);
  });

  // --- FR-2 crash clause: executed without an answer -------------------------

  describe('a crash between the commit and the stored answer (FR-2)', () => {
    it.each([
      [
        'POST /users (201)',
        201,
        async () => {
          const i = ++serial;
          return {
            req: {
              method: 'post',
              path: '/users',
              body: {
                email: `crash${i}@cgiar.org`,
                firstName: 'C',
                lastName: 'R',
                nickname: `Crash ${i}`,
                accountType: 'sso',
              },
            } as Req,
            targetId: undefined as number | undefined,
          };
        },
      ],
      [
        'POST /users/:id/deactivate (200)',
        200,
        async () => {
          const user = await person();
          return {
            req: {
              method: 'post',
              path: `/users/${user.id}/deactivate`,
            } as Req,
            targetId: user.id,
          };
        },
      ],
    ])(
      '%s: the replay answers the route status with the current detail and runs nothing',
      async (_name, status, make) => {
        const { req, targetId } = await make();
        const key = newKey('crash');
        const complete = vi
          .spyOn(w.idempotency, 'complete')
          .mockRejectedValueOnce(new Error('process died'));
        const before = effects();

        const first = await send(req, key);
        complete.mockRestore();
        expect(first.status).toBe(status);
        const afterFirst = effects();
        const id = targetId ?? first.body.data.id;
        expect(w.db.idempotency.find((row) => row.idemKey === key)?.state).toBe(
          'executed',
        );
        await w.users.update(id, { nickname: `Fresh ${serial}` });

        const replay = await send(req, key);
        expect(replay.status).toBe(status);
        expect(replay.headers['idempotency-replayed']).toBe('true');
        expect(replay.body.data).toMatchObject({
          id,
          nickname: `Fresh ${serial}`,
        });
        expect(effects()).toEqual(afterFirst);
        expect(since(before).audit).toBeGreaterThan(0);
      },
    );
  });

  // --- T-4 review: a lost fence is neither remembered nor released ------------

  it('a stalled first request that lost its key to a take-over answers 409 and leaves the taker row and answer alone (DD-3)', async () => {
    const user = await person();
    const req: Req = { method: 'post', path: `/users/${user.id}/deactivate` };
    const key = newKey('fence');
    const reached = deferred();
    const gate = deferred();
    let held = false;
    w.unitOfWork.beforeMark = async () => {
      if (held) return; // the taker passes straight through
      held = true;
      reached.resolve();
      await gate.promise;
    };
    const before = effects();

    const stalled = send(req, key).then((res) => res);
    await reached.promise;
    const stalledToken = w.idempotency.peek(w.admin.id, key)!.ownerToken;
    w.clock.advance(IDEMPOTENCY_LEASE_MS + 1_000);

    // The taker takes the key over, then waits for the row lock the stalled one holds.
    const taker = send(req, key).then((res) => res);
    for (let turn = 0; turn < 500; turn++) {
      if (w.idempotency.peek(w.admin.id, key)!.ownerToken !== stalledToken)
        break;
      await roundTrip();
    }
    expect(w.idempotency.peek(w.admin.id, key)!.ownerToken).not.toBe(
      stalledToken,
    );
    gate.resolve();

    const [lost, won] = await Promise.all([stalled, taker]);
    expectError(lost, 409, 'IDEMPOTENCY_IN_PROGRESS');
    expect(won.status).toBe(200);
    expect(won.body.data).toMatchObject({ id: user.id, status: 'inactive' });
    // One deactivation in total, and the row holds the taker's answer.
    expect(since(before)).toEqual({ ...NONE, audit: 1, invalidations: 1 });
    const row = w.idempotency.peek(w.admin.id, key)!;
    expect(row.state).toBe('completed');
    expect(row.responseStatus).toBe(200);
    expect(row.responseBody).toMatchObject({ id: user.id, status: 'inactive' });
    const replay = await send(req, key);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual(won.body.data);
  });

  // --- FR-10: the contract documents the key on every write -------------------

  describe('OpenAPI (FR-10)', () => {
    const WRITES = [
      ['post', '/users', '201'],
      ['patch', '/users/{id}', '200'],
      ['put', '/users/{id}', '200'],
      ['put', '/users/{id}/roles', '200'],
      ['put', '/users/{id}/programs', '200'],
      ['post', '/users/{id}/exclusions', '201'],
      ['delete', '/users/{id}/exclusions/{exclusionId}', '200'],
      ['post', '/users/{id}/exclusions/{exclusionId}/dismiss', '200'],
      ['post', '/users/{id}/deactivate', '200'],
      ['post', '/users/{id}/activate', '200'],
      ['post', '/users/{id}/invitation', '200'],
    ] as const;
    type Operation = {
      parameters?: Array<{
        name: string;
        in: string;
        required?: boolean;
        schema?: Record<string, unknown>;
      }>;
      responses: Record<string, { headers?: Record<string, unknown> }>;
    };
    const operation = (method: string, path: string) =>
      (
        buildOpenApiDocument(w.app).paths[`/api/v1${path}`] as Record<
          string,
          Operation
        >
      )[method]!;

    it.each(WRITES)(
      '%s %s documents the optional Idempotency-Key request header and the replay marker on its %s answer',
      (method, path, success) => {
        const op = operation(method, path);
        const keys = (op.parameters ?? []).filter(
          (parameter) => parameter.in === 'header',
        );
        expect(keys.map((parameter) => parameter.name)).toEqual([
          'Idempotency-Key',
        ]);
        expect(keys[0]!.required).toBe(false);
        expect(keys[0]!.schema).toMatchObject({
          type: 'string',
          minLength: 1,
          maxLength: 128,
        });
        expect(Object.keys(op.responses[success]!.headers ?? {})).toEqual([
          'Idempotency-Replayed',
        ]);
      },
    );

    it('documents the header on no read route and on no error answer', () => {
      for (const [method, path] of [
        ['get', '/users'],
        ['get', '/users/{id}'],
      ] as const) {
        const op = operation(method, path);
        expect((op.parameters ?? []).filter((p) => p.in === 'header')).toEqual(
          [],
        );
        expect(JSON.stringify(op.responses)).not.toContain('Idempotency');
      }
      for (const [method, path] of WRITES) {
        const op = operation(method, path);
        for (const [status, response] of Object.entries(op.responses)) {
          if (status.startsWith('2')) continue;
          expect(
            response.headers,
            `${method} ${path} ${status}`,
          ).toBeUndefined();
        }
      }
    });
  });
});
