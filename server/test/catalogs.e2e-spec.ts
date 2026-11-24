import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import { REQUIRE_PERMISSION_KEY } from '../src/auth/decorators/require-permission.decorator.js';
import { CatalogsController } from '../src/users/catalogs/catalogs.controller.js';
import { UpstreamUnavailableError } from '../src/users/catalogs/catalogs.errors.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../src/users/catalogs/catalogs.ports.js';
import { Permission, ROLE_DEFINITIONS } from '../src/users/permissions.js';
import {
  ROLE_ASSIGNMENTS_STORE,
  RoleAssignmentsRepository,
} from '../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../src/users/user-programs.repository.js';
import { USERS_STORE, UsersRepository } from '../src/users/users.repository.js';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUserProgramsStore,
  InMemoryUsersStore,
} from './support/in-memory-stores.js';
import {
  localJwksCache,
  newKeyPair,
  signJwt,
} from './support/jwt-test-keys.js';

// FR-1 (route part) and FR-11 over the real app: guards are real, only the
// catalog sources, the stores and the JWKS are replaced.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('catalogs-e2e-kid');
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

const TYPES = [
  { key: 'KP', name: 'Knowledge product' },
  { key: 'POLICY', name: 'Policy change' },
];
const PROGRAMS = [{ id: 1, code: 'INIT-01', name: 'Accelerated Breeding' }];

const ROUTES = [
  '/catalogs/roles',
  '/catalogs/result-types',
  '/catalogs/science-programs',
];

describe('Catalog routes (e2e)', () => {
  let app: NestExpressApplication;
  const resultTypes = { list: vi.fn() };
  const programs = { list: vi.fn() };

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    resultTypes.list.mockReset().mockResolvedValue(TYPES);
    programs.list.mockReset().mockResolvedValue(PROGRAMS);

    const usersStore = new InMemoryUsersStore();
    const assignmentsStore = new InMemoryRoleAssignmentsStore();
    for (const role of ROLE_DEFINITIONS) {
      assignmentsStore.addRole({
        code: role.code,
        name: role.name,
        scopeType: role.scopeType,
        isActive: true,
      });
    }
    const users = new UsersRepository(usersStore);
    const assignments = new RoleAssignmentsRepository(assignmentsStore);
    const admin = await users.create({
      email: 'admin@cgiar.org',
      cognitoSub: 'sub-admin',
      firstName: 'Ada',
      lastName: 'Admin',
      authSource: 'sso',
    });
    await assignments.create({ userId: admin.id, roleCode: 'ADMIN' });
    const assessor = await users.create({
      email: 'assessor@cgiar.org',
      cognitoSub: 'sub-assessor',
      firstName: 'Al',
      lastName: 'Assessor',
      authSource: 'sso',
    });
    await assignments.create({
      userId: assessor.id,
      roleCode: 'ASSESSOR',
      resultTypeKey: 'KP',
    });
    const grants: [string, string, string?][] = [
      ['sub-lead', 'LEAD_ASSESSOR', 'KP'],
      ['sub-tpb', 'TPB'],
      ['sub-ppu', 'PPU'],
    ];
    for (const [sub, roleCode, resultTypeKey] of grants) {
      const user = await users.create({
        email: `${sub}@cgiar.org`,
        cognitoSub: sub,
        firstName: sub,
        lastName: 'User',
        authSource: 'sso',
      });
      await assignments.create({ userId: user.id, roleCode, resultTypeKey });
    }
    // GUEST: an SSO user with no assignment.
    await users.create({
      email: 'guest@cgiar.org',
      cognitoSub: 'sub-guest',
      firstName: 'Gus',
      lastName: 'Guest',
      authSource: 'sso',
    });
    const multi = await users.create({
      email: 'multi@cgiar.org',
      cognitoSub: 'sub-multi',
      firstName: 'Mia',
      lastName: 'Multi',
      authSource: 'sso',
    });
    await assignments.create({ userId: multi.id, roleCode: 'TPB' });
    await assignments.create({ userId: multi.id, roleCode: 'PPU' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(USERS_STORE)
      .useValue(usersStore)
      .overrideProvider(ROLE_ASSIGNMENTS_STORE)
      .useValue(assignmentsStore)
      .overrideProvider(USER_PROGRAMS_STORE)
      .useValue(new InMemoryUserProgramsStore())
      .overrideProvider(JWKS_CACHE)
      .useValue(localJwksCache(signer))
      .overrideProvider(RESULT_TYPE_SOURCE)
      .useValue(resultTypes)
      .overrideProvider(SCIENCE_PROGRAM_SOURCE)
      .useValue(programs)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const get = (path: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    return authorization === undefined
      ? req
      : req.set('Authorization', authorization);
  };

  it.each(ROUTES)(
    'GET %s without a token answers 401 AUTH_TOKEN_INVALID',
    async (path) => {
      const res = await get(path).expect(401);
      expect(res.body.error).toMatchObject({
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
      });
      expect(resultTypes.list).not.toHaveBeenCalled();
      expect(programs.list).not.toHaveBeenCalled();
    },
  );

  it('CatalogsController declares ADMIN_ACCESS (inventory)', () => {
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, CatalogsController),
    ).toBe(Permission.ADMIN_ACCESS);
  });

  const NON_ADMINS = [
    ['Assessor', 'sub-assessor'],
    ['Lead Assessor', 'sub-lead'],
    ['TPB', 'sub-tpb'],
    ['PPU', 'sub-ppu'],
    ['GUEST', 'sub-guest'],
    ['multi-grant (TPB + PPU)', 'sub-multi'],
  ];
  const DENIED = NON_ADMINS.flatMap(([label, sub]) =>
    ROUTES.map((path) => [label, sub, path]),
  );

  it.each(DENIED)(
    'GET as %s (%s) %s answers 403 and reads no source',
    async (_label, sub, path) => {
      const res = await get(path, bearer(sub)).expect(403);
      expect(res.body).toMatchObject({
        success: false,
        error: { status: 403, code: 'AUTH_PERMISSION_DENIED' },
      });
      expect(resultTypes.list).not.toHaveBeenCalled();
      expect(programs.list).not.toHaveBeenCalled();
    },
  );

  it('GET /catalogs/roles returns the grantable roles for an ADMIN, never PROGRAM', async () => {
    const res = await get('/catalogs/roles', bearer('sub-admin')).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      { code: 'ADMIN', name: 'Administrator', scopeType: 'global' },
      {
        code: 'LEAD_ASSESSOR',
        name: 'Lead assessor',
        scopeType: 'result_type',
      },
      { code: 'ASSESSOR', name: 'Assessor', scopeType: 'result_type' },
      { code: 'TPB', name: 'TPB', scopeType: 'global' },
      { code: 'PPU', name: 'PPU', scopeType: 'global' },
    ]);
  });

  it('GET /catalogs/result-types returns { key, name } for an ADMIN', async () => {
    const res = await get('/catalogs/result-types', bearer('sub-admin')).expect(
      200,
    );
    expect(res.body.data).toEqual(TYPES);
  });

  it('GET /catalogs/science-programs returns { id, code, name } for an ADMIN', async () => {
    const res = await get(
      '/catalogs/science-programs',
      bearer('sub-admin'),
    ).expect(200);
    expect(res.body.data).toEqual(PROGRAMS);
  });

  it.each([
    ['/catalogs/result-types', resultTypes],
    ['/catalogs/science-programs', programs],
  ])(
    'GET %s answers the 503 envelope when the source fails and nothing is cached',
    async (path, source) => {
      source.list.mockRejectedValue(new UpstreamUnavailableError());
      const res = await get(path, bearer('sub-admin')).expect(503);
      expect(res.body).toEqual({
        success: false,
        error: {
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          message:
            'The service is temporarily unavailable. Try again in a few minutes.',
        },
        meta: { requestId: expect.any(String), timestamp: expect.any(String) },
      });
      expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
    },
  );

  it('serves the cached copy when the source fails after a success', async () => {
    await get('/catalogs/result-types', bearer('sub-admin')).expect(200);
    resultTypes.list.mockRejectedValue(new UpstreamUnavailableError());
    const res = await get('/catalogs/result-types', bearer('sub-admin')).expect(
      200,
    );
    expect(res.body.data).toEqual(TYPES);
    expect(resultTypes.list).toHaveBeenCalledTimes(1); // still fresh: not asked again
  });
});
