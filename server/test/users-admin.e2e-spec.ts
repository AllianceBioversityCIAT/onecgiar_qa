import { Logger, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator.js';
import { REQUIRE_PERMISSION_KEY } from '../src/auth/decorators/require-permission.decorator.js';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import { UsersAdminController } from '../src/users/users-admin.controller.js';
import { CognitoAdminClient } from '../src/auth/cognito-admin.client.js';
import { UpstreamUnavailableError } from '../src/auth/cognito-auth.client.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../src/users/user-programs.repository.js';
import { USERS_ADMIN_UNIT_OF_WORK } from '../src/users/users-admin.unit-of-work.js';
import { USERS_QUERY_STORE } from '../src/users/users-query.repository.js';
import { USERS_STORE } from '../src/users/users.repository.js';
import { InMemoryUsersAdminUnitOfWork } from './support/in-memory-stores.js';
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

// FR-1 (HTTP part), FR-2…FR-5, FR-7…FR-10 and FR-12 over the real app: the
// guards, the pipe, the filter and the OpenAPI wiring are real; the stores,
// Cognito and the catalog sources are the in-memory world. Expected values
// are written out from the spec (design 6), never imported from the code.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('users-admin-e2e-kid');
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

type World = Awaited<ReturnType<typeof build>>;

async function build() {
  const w = adminWorld();
  const actor = async (
    sub: string,
    roles: Array<[string, string?]>,
    over: { nickname?: string; authSource?: 'sso' | 'custom' } = {},
  ) => {
    const user = await w.users.create({
      email: `${sub}@cgiar.org`,
      cognitoSub: sub,
      firstName: sub,
      lastName: 'Actor',
      authSource: over.authSource ?? 'sso',
      nickname: over.nickname ?? null,
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
  const admin = await actor('sub-admin', [['ADMIN']], { nickname: 'Ada' });
  const roleUsers = {
    ASSESSOR: await actor('sub-assessor', [['ASSESSOR', 'KP']]),
    // The only non-admin role with two permissions, on the `*` grant (DD-1).
    LEAD_ASSESSOR: await actor('sub-lead_assessor', [['LEAD_ASSESSOR', '*']]),
    // Several grants at once: none of them may add up to admin access.
    MULTI_GRANT: await actor('sub-multi_grant', [['ASSESSOR', 'KP'], ['TPB']]),
    TPB: await actor('sub-tpb', [['TPB']]),
    PPU: await actor('sub-ppu', [['PPU']]),
    GUEST: await actor('sub-guest', []),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USERS_STORE)
    .useValue(w.db.stores.users)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(w.db.stores.assignments)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(w.db.stores.programs)
    .overrideProvider(USERS_ADMIN_UNIT_OF_WORK)
    .useValue(new InMemoryUsersAdminUnitOfWork(w.db))
    .overrideProvider(USERS_QUERY_STORE)
    .useValue(new InMemoryUsersQueryStore(w.db))
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

  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    token?: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (token !== undefined) req.set('Authorization', token);
    return body === undefined ? req : req.send(body);
  };
  return { ...w, app, admin, roleUsers, call, adminToken: bearer('sub-admin') };
}

/** `res.body.error` plus the status: what a client sees, without request-bound meta. */
const refusal = (res: request.Response) => ({
  status: res.status,
  error: res.body.error,
  success: res.body.success,
});

/** Orders `[field, code]` pairs by field name, to compare lists whose order is not the point. */
const byField = (a: string[], b: string[]) => a[0]!.localeCompare(b[0]!);

const fieldsOf = (res: request.Response): Array<[string, string]> =>
  (res.body.error.fields as Array<{ field: string; code: string }>).map(
    ({ field, code }) => [field, code],
  );

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

describe('Users admin routes (e2e)', () => {
  let w: World;

  beforeEach(async () => {
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    w = await build();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await w.app.close();
  });

  const target = (over: Parameters<World['seedUser']>[0]) => w.seedUser(over);
  const asAdmin = (
    method: Parameters<World['call']>[0],
    path: string,
    body?: object,
  ) => w.call(method, path, w.adminToken, body);

  // --- FR-1: every route is admin only, and refuses without a hint ------------

  describe('FR-1: access', () => {
    const MISSING = 99999;
    type Row = [
      string,
      Parameters<World['call']>[0],
      (id: number) => string,
      object?,
    ];
    const ROUTES: Row[] = [
      ['list', 'get', () => '/users'],
      ['detail', 'get', (id) => `/users/${id}`],
      [
        'create',
        'post',
        () => '/users',
        {
          email: 'new@cgiar.org',
          firstName: 'New',
          lastName: 'User',
          nickname: 'Newbie',
          accountType: 'custom',
        },
      ],
      ['edit', 'patch', (id) => `/users/${id}`, { nickname: 'Renamed' }],
      [
        'roles',
        'put',
        (id) => `/users/${id}/roles`,
        { roles: [{ role: 'TPB' }] },
      ],
      ['programs', 'put', (id) => `/users/${id}/programs`, { programs: [1] }],
      [
        'exclusion add',
        'post',
        (id) => `/users/${id}/exclusions`,
        { programId: 1, reason: 'Conflict' },
      ],
      ['exclusion remove', 'delete', (id) => `/users/${id}/exclusions/1`],
      [
        'exclusion dismiss',
        'post',
        (id) => `/users/${id}/exclusions/1/dismiss`,
        { reason: 'Not a conflict' },
      ],
      ['deactivate', 'post', (id) => `/users/${id}/deactivate`],
      ['activate', 'post', (id) => `/users/${id}/activate`],
      ['invitation', 'post', (id) => `/users/${id}/invitation`],
    ];
    const NON_ADMINS = [
      'ASSESSOR',
      'LEAD_ASSESSOR',
      'TPB',
      'PPU',
      'GUEST',
      'MULTI_GRANT',
    ] as const;

    it('has a 403 row for every grantable role (a new role without one fails here)', () => {
      const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
      for (const { code } of GRANTABLE_ROLES) {
        expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
      }
    });

    it.each(ROUTES)(
      '%s: 401 without a token, before anything else',
      async (_name, method, path, body) => {
        const before = w.snapshot();
        const res = await w.call(method, path(1), undefined, body);
        expectError(res, 401, 'AUTH_TOKEN_INVALID');
        expect(w.snapshot()).toBe(before);
      },
    );

    for (const role of NON_ADMINS) {
      it.each(ROUTES)(
        `%s: ${role} gets 403 AUTH_PERMISSION_DENIED, the same for an existing and a missing id, and nothing is written`,
        async (_name, method, path, body) => {
          const existing = await target({
            email: 'victim@cgiar.org',
            nickname: 'Victim',
            roles: [['TPB']],
          });
          const token = bearer(`sub-${role.toLowerCase()}`);
          const before = w.snapshot();

          const onExisting = await w.call(
            method,
            path(existing.id),
            token,
            body,
          );
          const onMissing = await w.call(method, path(MISSING), token, body);

          expectError(onExisting, 403, 'AUTH_PERMISSION_DENIED');
          expectError(onMissing, 403, 'AUTH_PERMISSION_DENIED');
          // Byte-equal answers: nothing tells the caller whether the id exists.
          expect(refusal(onMissing)).toEqual(refusal(onExisting));
          expect(JSON.stringify(onMissing.body.error)).toBe(
            JSON.stringify(onExisting.body.error),
          );
          expect(w.snapshot()).toBe(before);
          expect(w.cognito.createUser).not.toHaveBeenCalled();
          expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
        },
      );
    }
  });

  describe('FR-1: the route inventory of the controller', () => {
    it('declares ADMIN_ACCESS on every one of its 12 routes and none as public', () => {
      const reflector = new Reflector();
      const served = Object.getOwnPropertyNames(UsersAdminController.prototype)
        .map(
          (name) =>
            [name, UsersAdminController.prototype[name as never]] as const,
        )
        .filter(([, handler]) => typeof handler === 'function')
        .filter(([, handler]) => Reflect.hasMetadata(METHOD_METADATA, handler))
        .map(([name, handler]) => ({
          name,
          method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)],
          path: Reflect.getMetadata(PATH_METADATA, handler) as string,
          permission: reflector.getAllAndOverride(REQUIRE_PERMISSION_KEY, [
            handler,
            UsersAdminController,
          ]),
          isPublic: reflector.getAllAndOverride(IS_PUBLIC_KEY, [
            handler,
            UsersAdminController,
          ]),
        }));
      expect(served.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
        [
          'DELETE :id/exclusions/:exclusionId',
          'GET /',
          'GET :id',
          'PATCH :id',
          'POST /',
          'POST :id/activate',
          'POST :id/deactivate',
          'POST :id/exclusions',
          'POST :id/exclusions/:exclusionId/dismiss',
          'POST :id/invitation',
          'PUT :id/programs',
          'PUT :id/roles',
        ].sort(),
      );
      for (const route of served) {
        expect(route.permission, route.name).toBe('ADMIN_ACCESS');
        expect(route.isPublic, route.name).toBeFalsy();
      }
    });
  });

  // --- FR-9: list ---------------------------------------------------------------

  describe('GET /users', () => {
    it('returns the team by nickname with the summary shape and meta.page.nextCursor null on the last page', async () => {
      await target({
        email: 'zed@cgiar.org',
        nickname: 'Zed',
        roles: [['ASSESSOR', 'KP']],
        firstName: 'Zed',
        lastName: 'Zulu',
      });
      const res = await asAdmin('get', '/users').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.meta.page).toEqual({ nextCursor: null });
      // Named users first by nickname, then the team members with no nickname by id.
      const nicknames = res.body.data.map(
        (u: { nickname: string | null }) => u.nickname,
      );
      expect(nicknames).toEqual(['Ada', 'Zed', null, null, null, null, null]);
      expect(Object.keys(res.body.data[1]).sort()).toEqual([
        'accountType',
        'email',
        'exclusions',
        'firstName',
        'id',
        'invitation',
        'lastName',
        'lastSignInAt',
        'nickname',
        'programs',
        'roles',
        'status',
      ]);
      expect(res.body.data[1]).toMatchObject({
        email: 'zed@cgiar.org',
        accountType: 'custom',
        status: 'active',
        roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }],
        programs: 'all',
        exclusions: [],
      });
    });

    it('pages with an opaque cursor and reports the next one', async () => {
      await target({ email: 'b@cgiar.org', nickname: 'Bea', roles: [['TPB']] });
      await target({ email: 'c@cgiar.org', nickname: 'Cy', roles: [['TPB']] });
      const page = async (query: string) => {
        const res = await asAdmin('get', `/users?${query}`).expect(200);
        return [
          res.body.data.map((u: { nickname: string | null }) => u.nickname),
          res.body.meta.page.nextCursor as string | null,
        ] as const;
      };
      const [first, cursor] = await page('limit=2');
      expect(first).toEqual(['Ada', 'Bea']);
      expect(typeof cursor).toBe('string');
      const [second, next] = await page(
        `limit=2&cursor=${encodeURIComponent(cursor!)}`,
      );
      expect(second).toEqual(['Cy', null]);
      expect(typeof next).toBe('string');
      const [rest, more] = await page(
        `limit=2&cursor=${encodeURIComponent(next!)}`,
      );
      expect(rest).toEqual([null, null]);
      expect(typeof more).toBe('string');
      const [last, end] = await page(
        `limit=2&cursor=${encodeURIComponent(more!)}`,
      );
      expect(last).toEqual([null, null]);
      expect(end).toBeNull();
    });

    it('filters: q, role, resultType, programId, status, population, hasExclusions', async () => {
      await target({
        email: 'kp@cgiar.org',
        nickname: 'Kappa',
        roles: [['ASSESSOR', 'KP']],
      });
      const off = await target({
        email: 'off@cgiar.org',
        nickname: 'Off',
        roles: [['TPB']],
        isActive: false,
      });
      const nicks = async (query: string) =>
        (await asAdmin('get', `/users?${query}`).expect(200)).body.data
          .map((u: { nickname: string | null }) => u.nickname)
          .filter((nickname: string | null) => nickname !== null);
      expect(await nicks('q=kapp')).toEqual(['Kappa']);
      expect(await nicks('role=ASSESSOR')).toEqual(['Kappa']);
      expect(await nicks('role=ASSESSOR&resultType=POLICY')).toEqual([]);
      expect(await nicks('resultType=KP')).toEqual(['Kappa']);
      expect(await nicks('status=inactive')).toEqual(['Off']);
      expect(await nicks('status=all')).toEqual(['Ada', 'Kappa', 'Off']);
      // The only user with no grant and not created by anyone is the GUEST.
      const guests = await asAdmin('get', '/users?population=guests').expect(
        200,
      );
      expect(guests.body.data.map((u: { id: number }) => u.id)).toEqual([
        w.roleUsers.GUEST.id,
      ]);
      await w.programs.replaceScope(off.id, [2]);
      expect(await nicks('status=all&programId=1')).toEqual(['Ada', 'Kappa']);
      expect(await nicks('hasExclusions=true')).toEqual([]);
      expect(await nicks('hasExclusions=false')).toEqual(['Ada', 'Kappa']);
    });

    it('refuses an unusable cursor, limit or query field with VALIDATION_FAILED on that field', async () => {
      const cases: Array<[string, string]> = [
        ['cursor=not-a-cursor!', 'cursor'],
        ['limit=0', 'limit'],
        ['limit=201', 'limit'],
        ['limit=abc', 'limit'],
        ['status=archived', 'status'],
        ['population=everyone', 'population'],
        ['hasExclusions=maybe', 'hasExclusions'],
        ['programId=abc', 'programId'],
        ['sort=nickname', 'sort'],
      ];
      for (const [query, field] of cases) {
        const res = await asAdmin('get', `/users?${query}`);
        expectError(res, 400, 'VALIDATION_FAILED');
        expect(
          fieldsOf(res).map(([name]) => name),
          query,
        ).toEqual([field]);
      }
    });
  });

  // --- FR-10: detail -------------------------------------------------------------

  describe('GET /users/:id', () => {
    it('returns the detail: the summary plus exclusionHistory', async () => {
      const user = await target({
        email: 'detail@cgiar.org',
        nickname: 'Detail',
        roles: [['LEAD_ASSESSOR', '*']],
      });
      const res = await asAdmin('get', `/users/${user.id}`).expect(200);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'accountType',
        'email',
        'exclusionHistory',
        'exclusions',
        'firstName',
        'id',
        'invitation',
        'lastName',
        'lastSignInAt',
        'nickname',
        'programs',
        'roles',
        'status',
      ]);
      expect(res.body.data.roles).toEqual([
        { role: 'LEAD_ASSESSOR', resultTypes: 'all' },
      ]);
      expect(res.body.data.exclusionHistory).toEqual([]);
    });

    it('answers 404 USERS_NOT_FOUND for a missing user, and 400 for an id that is not a number', async () => {
      expectError(await asAdmin('get', '/users/99999'), 404, 'USERS_NOT_FOUND');
      const bad = await asAdmin('get', '/users/abc');
      expectError(bad, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(bad)).toEqual([['id', 'INVALID_TYPE']]);
    });
  });

  // --- FR-2: create --------------------------------------------------------------

  describe('POST /users', () => {
    const body = {
      email: 'New.Person@CGIAR.org',
      firstName: 'New',
      lastName: 'Person',
      nickname: 'Newbie',
      accountType: 'custom',
      roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }, { role: 'TPB' }],
      programs: [1, 2],
      exclusions: [{ programId: 1, reason: 'Co-author' }],
    };

    it('creates a custom user: 201, the detail, Cognito invited, everything stored and audited', async () => {
      const res = await asAdmin('post', '/users', body).expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        email: 'new.person@cgiar.org',
        nickname: 'Newbie',
        accountType: 'custom',
        status: 'active',
        invitation: 'sent',
        roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }, { role: 'TPB' }],
        programs: [1, 2],
        exclusions: [{ programId: 1, origin: 'manual', reason: 'Co-author' }],
        exclusionHistory: [],
      });
      expect(w.cognito.createUser).toHaveBeenCalledTimes(1);
      expect(w.db.users.some((u) => u.email === 'new.person@cgiar.org')).toBe(
        true,
      );
      expect(w.db.audit.length).toBeGreaterThan(0);
    });

    it('creates an SSO user without calling Cognito', async () => {
      const res = await asAdmin('post', '/users', {
        ...body,
        accountType: 'sso',
        roles: [],
        programs: undefined,
        exclusions: undefined,
      }).expect(201);
      expect(res.body.data.accountType).toBe('sso');
      expect(res.body.data.programs).toBe('all');
      expect(w.cognito.getUser).not.toHaveBeenCalled();
      expect(w.cognito.createUser).not.toHaveBeenCalled();
    });

    it('reports every missing or malformed field by name, and writes nothing', async () => {
      const before = w.snapshot();
      const res = await asAdmin('post', '/users', {
        email: 'not-an-email',
        firstName: '',
        accountType: 'robot',
        unexpected: true,
      });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res).sort(byField)).toEqual(
        [
          ['accountType', 'INVALID'],
          ['email', 'INVALID_EMAIL'],
          ['firstName', 'REQUIRED'],
          ['lastName', 'REQUIRED'],
          ['nickname', 'REQUIRED'],
          ['unexpected', 'UNKNOWN_FIELD'],
        ].sort(byField),
      );
      expect(w.snapshot()).toBe(before);
      expect(w.cognito.createUser).not.toHaveBeenCalled();
    });

    it('rejects too long values, programs: [] and a duplicate exclusion program on the field that is wrong', async () => {
      const base = { ...body, roles: [], exclusions: undefined };
      const long = await asAdmin('post', '/users', {
        ...base,
        nickname: 'n'.repeat(51),
      });
      expect(fieldsOf(long)).toEqual([['nickname', 'TOO_LONG']]);

      const empty = await asAdmin('post', '/users', { ...base, programs: [] });
      expectError(empty, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(empty)).toEqual([['programs', 'INVALID']]);

      const twice = await asAdmin('post', '/users', {
        ...base,
        exclusions: [
          { programId: 1, reason: 'a' },
          { programId: 2, reason: 'b' },
          { programId: 1, reason: 'c' },
        ],
      });
      expectError(twice, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(twice)).toEqual([['exclusions[2].programId', 'INVALID']]);

      // The pipe judges the shape first and reports every bad item by index...
      const shape = await asAdmin('post', '/users', {
        ...base,
        exclusions: [{ programId: 'x', reason: '' }],
      });
      expect(fieldsOf(shape).sort(byField)).toEqual(
        [
          ['exclusions[0].programId', 'INVALID_TYPE'],
          ['exclusions[0].reason', 'REQUIRED'],
        ].sort(byField),
      );
      // ...then the service judges the roles and the catalog references.
      const roles = await asAdmin('post', '/users', {
        ...base,
        roles: [{ role: 'PROGRAM' }, { role: 'ASSESSOR' }],
      });
      expect(fieldsOf(roles).sort(byField)).toEqual(
        [
          ['roles[0].role', 'INVALID'],
          ['roles[1].resultTypes', 'REQUIRED'],
        ].sort(byField),
      );
      const unknownProgram = await asAdmin('post', '/users', {
        ...base,
        programs: [99],
        exclusions: [{ programId: 98, reason: 'r' }],
      });
      expect(fieldsOf(unknownProgram).sort(byField)).toEqual(
        [
          ['exclusions[0].programId', 'INVALID'],
          ['programs', 'INVALID'],
        ].sort(byField),
      );
    });

    it('answers 409 for a taken email, a taken nickname (any case) and an Assessor + Lead overlap', async () => {
      await target({
        email: 'taken@cgiar.org',
        nickname: 'Taken',
        roles: [['TPB']],
      });
      expectError(
        await asAdmin('post', '/users', { ...body, email: 'TAKEN@cgiar.org' }),
        409,
        'USERS_EMAIL_TAKEN',
      );
      expectError(
        await asAdmin('post', '/users', { ...body, nickname: 'tAkEn' }),
        409,
        'USERS_NICKNAME_TAKEN',
      );
      expectError(
        await asAdmin('post', '/users', {
          ...body,
          roles: [
            { role: 'ASSESSOR', resultTypes: ['KP'] },
            { role: 'LEAD_ASSESSOR', resultTypes: 'all' },
          ],
        }),
        409,
        'USERS_ROLE_CONFLICT',
      );
    });

    it('answers 503 and stores nothing when Cognito is unavailable', async () => {
      w.cognito.getUser.mockRejectedValueOnce(new UpstreamUnavailableError());
      const before = w.snapshot();
      const res = await asAdmin('post', '/users', body);
      expectError(res, 503, 'AUTH_SERVICE_UNAVAILABLE');
      expect(w.snapshot()).toBe(before);
    });
  });

  // --- FR-5: edit ----------------------------------------------------------------

  describe('PATCH /users/:id', () => {
    it('edits the nickname and, for a user who never signed in, the names', async () => {
      const user = await target({
        email: 'e@cgiar.org',
        nickname: 'Old',
        roles: [['TPB']],
      });
      const res = await asAdmin('patch', `/users/${user.id}`, {
        nickname: 'New',
        firstName: 'Fi',
        lastName: 'La',
      }).expect(200);
      expect(res.body.data).toMatchObject({
        id: user.id,
        nickname: 'New',
        firstName: 'Fi',
        lastName: 'La',
      });
    });

    it('answers 409 for a taken nickname and for a name edit after the first sign-in, 404 for a missing user', async () => {
      await target({
        email: 'a@cgiar.org',
        nickname: 'Taken',
        roles: [['TPB']],
      });
      const user = await target({
        email: 'b@cgiar.org',
        nickname: 'Mine',
        roles: [['TPB']],
        lastLoginAt: new Date('2026-01-01T00:00:00Z'),
      });
      expectError(
        await asAdmin('patch', `/users/${user.id}`, { nickname: 'taken' }),
        409,
        'USERS_NICKNAME_TAKEN',
      );
      expectError(
        await asAdmin('patch', `/users/${user.id}`, { firstName: 'Zed' }),
        409,
        'USERS_NAME_LOCKED',
      );
      expectError(
        await asAdmin('patch', '/users/99999', { nickname: 'X' }),
        404,
        'USERS_NOT_FOUND',
      );
    });

    it('refuses the email, empty values and unknown fields', async () => {
      const user = await target({
        email: 'c@cgiar.org',
        nickname: 'C',
        roles: [['TPB']],
      });
      const res = await asAdmin('patch', `/users/${user.id}`, {
        email: 'other@cgiar.org',
        nickname: '',
      });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res).sort(byField)).toEqual(
        [
          ['email', 'UNKNOWN_FIELD'],
          ['nickname', 'REQUIRED'],
        ].sort(byField),
      );
    });
  });

  // --- FR-3 / FR-7: roles --------------------------------------------------------

  describe('PUT /users/:id/roles', () => {
    it('replaces the roles and answers the detail', async () => {
      const user = await target({
        email: 'r@cgiar.org',
        nickname: 'R',
        roles: [['TPB']],
      });
      const res = await asAdmin('put', `/users/${user.id}/roles`, {
        roles: [
          { role: 'LEAD_ASSESSOR', resultTypes: ['KP', 'POLICY'] },
          { role: 'PPU' },
        ],
      }).expect(200);
      expect(res.body.data.roles).toEqual([
        { role: 'LEAD_ASSESSOR', resultTypes: ['KP', 'POLICY'] },
        { role: 'PPU' },
      ]);
    });

    it('refuses a role that is not grantable, an unknown result type, a malformed body: 400 on the field', async () => {
      const user = await target({
        email: 'r@cgiar.org',
        nickname: 'R',
        roles: [['TPB']],
      });
      const path = `/users/${user.id}/roles`;
      const program = await asAdmin('put', path, {
        roles: [{ role: 'PROGRAM' }],
      });
      expectError(program, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(program)).toEqual([['roles[0].role', 'INVALID']]);

      const type = await asAdmin('put', path, {
        roles: [{ role: 'ASSESSOR', resultTypes: ['NOPE'] }],
      });
      expect(fieldsOf(type)).toEqual([['roles[0].resultTypes', 'INVALID']]);

      const missing = await asAdmin('put', path, {});
      expect(fieldsOf(missing)).toEqual([['roles', 'REQUIRED']]);
      const notList = await asAdmin('put', path, { roles: 'TPB' });
      expectError(notList, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(notList)).toEqual([['roles', 'INVALID']]);
    });

    it('answers 404, 409 USERS_ROLE_CONFLICT and 409 USERS_LAST_ADMIN', async () => {
      expectError(
        await asAdmin('put', '/users/99999/roles', { roles: [] }),
        404,
        'USERS_NOT_FOUND',
      );
      const user = await target({
        email: 'r@cgiar.org',
        nickname: 'R',
        roles: [['TPB']],
      });
      expectError(
        await asAdmin('put', `/users/${user.id}/roles`, {
          roles: [
            { role: 'ASSESSOR', resultTypes: ['KP'] },
            { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
          ],
        }),
        409,
        'USERS_ROLE_CONFLICT',
      );
      const before = w.snapshot();
      expectError(
        await asAdmin('put', `/users/${w.admin.id}/roles`, { roles: [] }),
        409,
        'USERS_LAST_ADMIN',
      );
      expect(w.snapshot()).toBe(before);
    });
  });

  // --- FR-4: programs and exclusions ---------------------------------------------

  describe('programs and exclusions', () => {
    it('PUT programs: a list, then all', async () => {
      const user = await target({
        email: 'p@cgiar.org',
        nickname: 'P',
        roles: [['TPB']],
      });
      const path = `/users/${user.id}/programs`;
      expect(
        (await asAdmin('put', path, { programs: [3, 1] }).expect(200)).body.data
          .programs,
      ).toEqual([1, 3]);
      expect(
        (await asAdmin('put', path, { programs: 'all' }).expect(200)).body.data
          .programs,
      ).toBe('all');
    });

    it('PUT programs: 400 for [], an unknown program, a wrong type, a missing field; 404 for a missing user', async () => {
      const user = await target({
        email: 'p@cgiar.org',
        nickname: 'P',
        roles: [['TPB']],
      });
      const path = `/users/${user.id}/programs`;
      for (const programs of [[], [99], ['1'], 'some', [1, 1.5], [0]]) {
        const res = await asAdmin('put', path, { programs });
        expectError(res, 400, 'VALIDATION_FAILED');
        expect(
          fieldsOf(res).map(([name]) => name),
          JSON.stringify(programs),
        ).toEqual(['programs']);
      }
      const missing = await asAdmin('put', path, {});
      expect(fieldsOf(missing)).toEqual([['programs', 'REQUIRED']]);
      expectError(
        await asAdmin('put', '/users/99999/programs', { programs: 'all' }),
        404,
        'USERS_NOT_FOUND',
      );
    });

    it('POST exclusions: 201 with the detail; 400, 404 and 409 USERS_EXCLUSION_EXISTS', async () => {
      const user = await target({
        email: 'x@cgiar.org',
        nickname: 'X',
        roles: [['TPB']],
      });
      const path = `/users/${user.id}/exclusions`;
      const created = await asAdmin('post', path, {
        programId: 2,
        reason: 'Worked on it',
      }).expect(201);
      expect(created.body.data.exclusions).toMatchObject([
        { programId: 2, origin: 'manual', reason: 'Worked on it' },
      ]);

      expectError(
        await asAdmin('post', path, { programId: 2, reason: 'again' }),
        409,
        'USERS_EXCLUSION_EXISTS',
      );
      const noReason = await asAdmin('post', path, {
        programId: 3,
        reason: '',
      });
      expectError(noReason, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(noReason)).toEqual([['reason', 'REQUIRED']]);
      const unknown = await asAdmin('post', path, {
        programId: 99,
        reason: 'r',
      });
      expectError(unknown, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(unknown)).toEqual([['programId', 'INVALID']]);
      expectError(
        await asAdmin('post', '/users/99999/exclusions', {
          programId: 1,
          reason: 'r',
        }),
        404,
        'USERS_NOT_FOUND',
      );
    });

    it('DELETE exclusion: removes a manual one into the history; 404 and 409 USERS_EXCLUSION_NOT_MANUAL', async () => {
      const user = await target({
        email: 'x@cgiar.org',
        nickname: 'X',
        roles: [['TPB']],
      });
      await asAdmin('post', `/users/${user.id}/exclusions`, {
        programId: 1,
        reason: 'r',
      }).expect(201);
      await w.db.stores.programs.insertExclusion({
        userId: user.id,
        programId: 2,
        origin: 'reporting',
        reportingRole: 'Lead',
        createdBy: null,
      });
      const [manual, reporting] = w.db.exclusions;

      expectError(
        await asAdmin(
          'delete',
          `/users/${user.id}/exclusions/${reporting!.id}`,
        ),
        409,
        'USERS_EXCLUSION_NOT_MANUAL',
      );
      const ok = await asAdmin(
        'delete',
        `/users/${user.id}/exclusions/${manual!.id}`,
      ).expect(200);
      expect(ok.body.data.exclusions).toMatchObject([
        { id: reporting!.id, origin: 'reporting' },
      ]);
      expect(ok.body.data.exclusionHistory).toMatchObject([
        { id: manual!.id, status: 'removed' },
      ]);
      expectError(
        await asAdmin('delete', `/users/${user.id}/exclusions/${manual!.id}`),
        404,
        'USERS_EXCLUSION_NOT_FOUND',
      );
      expectError(
        await asAdmin('delete', `/users/99999/exclusions/${manual!.id}`),
        404,
        'USERS_NOT_FOUND',
      );
    });

    it('POST dismiss: dismisses a Reporting exclusion with a reason; 400, 404 and 409 USERS_EXCLUSION_NOT_REPORTING', async () => {
      const user = await target({
        email: 'x@cgiar.org',
        nickname: 'X',
        roles: [['TPB']],
      });
      await asAdmin('post', `/users/${user.id}/exclusions`, {
        programId: 1,
        reason: 'r',
      }).expect(201);
      await w.db.stores.programs.insertExclusion({
        userId: user.id,
        programId: 2,
        origin: 'reporting',
        reportingRole: 'Lead',
        createdBy: null,
      });
      const [manual, reporting] = w.db.exclusions;
      const dismiss = (id: number, payload: object) =>
        asAdmin('post', `/users/${user.id}/exclusions/${id}/dismiss`, payload);

      expectError(
        await dismiss(manual!.id, { reason: 'x' }),
        409,
        'USERS_EXCLUSION_NOT_REPORTING',
      );
      const noReason = await dismiss(reporting!.id, {});
      expectError(noReason, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(noReason)).toEqual([['reason', 'REQUIRED']]);
      const ok = await dismiss(reporting!.id, { reason: 'Not a conflict' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.exclusionHistory).toMatchObject([
        { id: reporting!.id, status: 'dismissed', endReason: 'Not a conflict' },
      ]);
      expectError(
        await dismiss(reporting!.id, { reason: 'again' }),
        404,
        'USERS_EXCLUSION_NOT_FOUND',
      );
      expectError(
        await asAdmin('post', '/users/99999/exclusions/1/dismiss', {
          reason: 'r',
        }),
        404,
        'USERS_NOT_FOUND',
      );
    });
  });

  // --- FR-7 / FR-8: status and invitation ----------------------------------------

  describe('deactivate, activate, invitation', () => {
    it('deactivates and reactivates, answering the detail with the status', async () => {
      const user = await target({
        email: 's@cgiar.org',
        nickname: 'S',
        roles: [['TPB']],
      });
      const off = await asAdmin('post', `/users/${user.id}/deactivate`).expect(
        200,
      );
      expect(off.body.data).toMatchObject({ id: user.id, status: 'inactive' });
      const on = await asAdmin('post', `/users/${user.id}/activate`).expect(
        200,
      );
      expect(on.body.data.status).toBe('active');
    });

    it('answers 404 for a missing user and 409 USERS_LAST_ADMIN for the only admin', async () => {
      for (const action of ['deactivate', 'activate', 'invitation']) {
        expectError(
          await asAdmin('post', `/users/99999/${action}`),
          404,
          'USERS_NOT_FOUND',
        );
      }
      expectError(
        await asAdmin('post', `/users/${w.admin.id}/deactivate`),
        409,
        'USERS_LAST_ADMIN',
      );
    });

    it('resends the invitation of a custom user who never signed in', async () => {
      const user = await target({
        email: 'i@cgiar.org',
        nickname: 'I',
        invitation: 'sent',
        roles: [['TPB']],
      });
      const res = await asAdmin('post', `/users/${user.id}/invitation`).expect(
        200,
      );
      expect(res.body.data).toMatchObject({ id: user.id, invitation: 'sent' });
      expect(w.cognito.resendInvitation).toHaveBeenCalledTimes(1);
    });

    it('answers 409 USERS_INVITATION_NOT_APPLICABLE for an SSO user, and 503 when Cognito is down', async () => {
      const sso = await target({
        email: 's@cgiar.org',
        nickname: 'S',
        authSource: 'sso',
        roles: [['TPB']],
      });
      expectError(
        await asAdmin('post', `/users/${sso.id}/invitation`),
        409,
        'USERS_INVITATION_NOT_APPLICABLE',
      );
      const custom = await target({
        email: 'c@cgiar.org',
        nickname: 'C',
        invitation: 'sent',
        roles: [['TPB']],
      });
      w.cognito.resendInvitation.mockRejectedValueOnce(
        new UpstreamUnavailableError(),
      );
      expectError(
        await asAdmin('post', `/users/${custom.id}/invitation`),
        503,
        'AUTH_SERVICE_UNAVAILABLE',
      );
    });
  });

  // --- OpenAPI: each route lists the codes it can answer --------------------------

  describe('OpenAPI', () => {
    const AUTH = {
      '401': ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
      '403': ['AUTH_PERMISSION_DENIED'],
    };
    const BODY = ['MALFORMED_JSON', 'VALIDATION_FAILED'];
    const EXPECTED: Array<[string, string, string, Record<string, string[]>]> =
      [
        ['get', '/users', '200', { ...AUTH, '400': ['VALIDATION_FAILED'] }],
        [
          'get',
          '/users/{id}',
          '200',
          { ...AUTH, '400': ['VALIDATION_FAILED'], '404': ['USERS_NOT_FOUND'] },
        ],
        [
          'post',
          '/users',
          '201',
          {
            ...AUTH,
            '400': BODY,
            '409': [
              'USERS_EMAIL_TAKEN',
              'USERS_NICKNAME_TAKEN',
              'USERS_ROLE_CONFLICT',
            ],
            '503': ['AUTH_SERVICE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'],
          },
        ],
        [
          'patch',
          '/users/{id}',
          '200',
          {
            ...AUTH,
            '400': BODY,
            '404': ['USERS_NOT_FOUND'],
            '409': ['USERS_NAME_LOCKED', 'USERS_NICKNAME_TAKEN'],
          },
        ],
        [
          'put',
          '/users/{id}/roles',
          '200',
          {
            ...AUTH,
            '400': BODY,
            '404': ['USERS_NOT_FOUND'],
            '409': ['USERS_LAST_ADMIN', 'USERS_ROLE_CONFLICT'],
            '503': ['SERVICE_UNAVAILABLE'],
          },
        ],
        [
          'put',
          '/users/{id}/programs',
          '200',
          {
            ...AUTH,
            '400': BODY,
            '404': ['USERS_NOT_FOUND'],
            '503': ['SERVICE_UNAVAILABLE'],
          },
        ],
        [
          'post',
          '/users/{id}/exclusions',
          '201',
          {
            ...AUTH,
            '400': BODY,
            '404': ['USERS_NOT_FOUND'],
            '409': ['USERS_EXCLUSION_EXISTS'],
            '503': ['SERVICE_UNAVAILABLE'],
          },
        ],
        [
          'delete',
          '/users/{id}/exclusions/{exclusionId}',
          '200',
          {
            ...AUTH,
            '400': ['VALIDATION_FAILED'],
            '404': ['USERS_EXCLUSION_NOT_FOUND', 'USERS_NOT_FOUND'],
            '409': ['USERS_EXCLUSION_NOT_MANUAL'],
          },
        ],
        [
          'post',
          '/users/{id}/exclusions/{exclusionId}/dismiss',
          '200',
          {
            ...AUTH,
            '400': BODY,
            '404': ['USERS_EXCLUSION_NOT_FOUND', 'USERS_NOT_FOUND'],
            '409': ['USERS_EXCLUSION_NOT_REPORTING'],
          },
        ],
        [
          'post',
          '/users/{id}/deactivate',
          '200',
          {
            ...AUTH,
            '400': ['VALIDATION_FAILED'],
            '404': ['USERS_NOT_FOUND'],
            '409': ['USERS_LAST_ADMIN'],
          },
        ],
        [
          'post',
          '/users/{id}/activate',
          '200',
          {
            ...AUTH,
            '400': ['VALIDATION_FAILED'],
            '404': ['USERS_NOT_FOUND'],
          },
        ],
        [
          'post',
          '/users/{id}/invitation',
          '200',
          {
            ...AUTH,
            '400': ['VALIDATION_FAILED'],
            '404': ['USERS_NOT_FOUND'],
            '409': ['USERS_INVITATION_NOT_APPLICABLE'],
            '503': ['AUTH_SERVICE_UNAVAILABLE'],
          },
        ],
      ];

    it.each(EXPECTED)(
      '%s %s documents %s and exactly these error codes',
      (method, path, success, errors) => {
        const doc = buildOpenApiDocument(w.app);
        const operation = (
          doc.paths[`/api/v1${path}`] as Record<
            string,
            { responses: Record<string, { description?: string }> }
          >
        )[method]!;
        expect(Object.keys(operation.responses).sort()).toEqual(
          [success, ...Object.keys(errors)].sort(),
        );
        for (const [status, codes] of Object.entries(errors)) {
          const listed = [
            ...String(operation.responses[status]!.description).matchAll(
              /`([A-Z_]+)`/g,
            ),
          ].map((match) => match[1]);
          expect(listed.sort(), `${method} ${path} ${status}`).toEqual(codes);
        }
      },
    );

    it('describes a list answer with meta.page.nextCursor', () => {
      const doc = buildOpenApiDocument(w.app);
      const list = JSON.stringify(
        (doc.paths['/api/v1/users'] as { get: unknown }).get,
      );
      expect(list).toContain('#/components/schemas/ApiPagedMetaModel');
      const schemas = doc.components?.schemas ?? {};
      expect(JSON.stringify(schemas.ApiPagedMetaModel)).toContain(
        '#/components/schemas/ApiPageMetaModel',
      );
      expect(Object.keys((schemas.ApiPageMetaModel as any).properties)).toEqual(
        ['nextCursor'],
      );
    });
  });
});
