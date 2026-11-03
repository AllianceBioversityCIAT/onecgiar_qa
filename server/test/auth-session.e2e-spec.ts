import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  ADMISSION_UNIT_OF_WORK,
  type AdmissionUnitOfWork,
} from '../src/auth/admission.service.js';
import {
  CognitoAuthClient,
  InvalidCredentialsError,
  UpstreamUnavailableError,
} from '../src/auth/cognito-auth.client.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import type { User } from '../src/database/drizzle/schema/index.js';
import {
  CURRENT_USER_CLOCK,
  CurrentUserCache,
} from '../src/users/current-user.cache.js';
import { ROLE_DEFINITIONS } from '../src/users/permissions.js';
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

// Session refresh and logout (FR-13, FR-14) over the real app. As in the login
// e2e, only the edges are replaced: the Cognito client is a fake, the verifier
// is real over a local key set, the database ports are in-memory fakes. The
// cookie names and Path are written out on purpose (not imported).

const REGION = process.env.COGNITO_REGION!;
const POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGINS!.split(',')[0];
const SESSION_PATH = '/api/v1/auth/session';
const ACCESS_TOKEN_TTL_S = 1800;

const signer = newKeyPair('session-e2e-kid');

const REFRESH_TOKEN = 'refresh-token-SECRET.session';
const USERNAME = 'cog-username-SECRET';
const SESSION_COOKIES = `qa_rt=${REFRESH_TOKEN}; qa_ru=${USERNAME}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const ADA = { sub: 'sub-ada', email: 'ada@cgiar.org' };

function idToken(sso = false): string {
  return signJwt(
    {
      sub: ADA.sub,
      iss: ISSUER,
      aud: CLIENT_ID,
      token_use: 'id',
      'cognito:username': USERNAME,
      email: ADA.email,
      email_verified: true,
      ...(sso
        ? { identities: [{ providerName: 'CGIAR-AzureAD', userId: ADA.email }] }
        : {}),
      given_name: 'Ada',
      family_name: 'Lovelace',
      auth_time: nowSeconds(),
      iat: nowSeconds(),
      exp: nowSeconds() + 3000,
    },
    signer,
  );
}

function accessToken(): string {
  return signJwt(
    {
      sub: ADA.sub,
      iss: ISSUER,
      client_id: CLIENT_ID,
      token_use: 'access',
      scope: 'aws.cognito.signin.user.admin',
      username: USERNAME,
      auth_time: nowSeconds(),
      iat: nowSeconds(),
      exp: nowSeconds() + ACCESS_TOKEN_TTL_S,
      jti: 'jti-session',
    },
    signer,
  );
}

const client = {
  loginCustom: vi.fn(),
  completeNewPassword: vi.fn(),
  providerUrl: vi.fn(),
  validateCode: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
};

interface World {
  app: NestExpressApplication;
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
  cache: CurrentUserCache;
  post(path: string): request.Test;
  close(): Promise<void>;
}

async function buildWorld(): Promise<World> {
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
  const unitOfWork: AdmissionUnitOfWork = {
    run: (work) => work({ users, assignments }),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CognitoAuthClient)
    .useValue(client)
    .overrideProvider(USERS_STORE)
    .useValue(usersStore)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(assignmentsStore)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(new InMemoryUserProgramsStore())
    .overrideProvider(ADMISSION_UNIT_OF_WORK)
    .useValue(unitOfWork)
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    .overrideProvider(CURRENT_USER_CLOCK)
    .useValue(() => 1_700_000_000_000)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    users,
    assignments,
    cache: moduleRef.get(CurrentUserCache, { strict: false }),
    post: (path) =>
      request(app.getHttpServer()).post(`/api/v1/auth/session/${path}`),
    close: () => app.close(),
  };
}

let adminAssignmentId = 0;

/** A custom user an admin registered and linked, with an ADMIN assignment. */
async function registerAda(world: World): Promise<User> {
  const user = await world.users.create({
    email: ADA.email,
    cognitoSub: ADA.sub,
    authSource: 'custom',
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
  const admin = await world.assignments.create({
    userId: user.id,
    roleCode: 'ADMIN',
  });
  adminAssignmentId = admin.id;
  return user;
}

// --- Cookie and envelope helpers --------------------------------------------------

interface ParsedCookie {
  name: string;
  value: string;
  attrs: string[];
}

function cookiesOf(res: request.Response): ParsedCookie[] {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const raw = header === undefined ? [] : [header].flat();
  return raw.map((line) => {
    const [pair, ...attrs] = line.split('; ');
    const eq = pair.indexOf('=');
    return {
      name: pair.slice(0, eq),
      value: decodeURIComponent(pair.slice(eq + 1)),
      attrs,
    };
  });
}

/** Both cookies expired, with the same Path and flags they were set with. */
function expectCleared(res: request.Response) {
  const cookies = cookiesOf(res);
  expect(cookies.map((c) => c.name).sort()).toEqual(['qa_rt', 'qa_ru']);
  for (const cookie of cookies) {
    const label = `cookie ${cookie.name}`;
    expect(cookie.value, `${label}: emptied`).toBe('');
    expect(cookie.attrs, `${label}: Path`).toContain(`Path=${SESSION_PATH}`);
    expect(cookie.attrs, `${label}: HttpOnly`).toContain('HttpOnly');
    expect(cookie.attrs, `${label}: Secure`).toContain('Secure');
    expect(
      cookie.attrs.some((a) => a.startsWith('Expires=Thu, 01 Jan 1970')),
      `${label}: expired`,
    ).toBe(true);
  }
}

function expectUntouched(res: request.Response) {
  expect(res.headers['set-cookie'], 'Set-Cookie header').toBeUndefined();
}

/**
 * The error envelope of the response standard: `{ success: false, error: {
 * status, code, message }, meta: { requestId, timestamp } }`, with the
 * request id echoed in the header. `code`, when given, is asserted too.
 */
function expectEnvelope(res: request.Response, status: number, code?: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code: expect.any(String), message: expect.any(String) },
    meta: { requestId: expect.any(String), timestamp: expect.any(String) },
  });
  expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  if (code !== undefined) expect(res.body.error.code).toBe(code);

  expect(JSON.stringify(res.body)).not.toContain('accessToken');
  expect(res.text).not.toContain(REFRESH_TOKEN);
  expect(res.text).not.toContain(USERNAME);
}

// --- Tests ------------------------------------------------------------------------

let world: World;

beforeEach(async () => {
  vi.resetAllMocks();
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
  world = await buildWorld();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await world.close();
});

describe('POST /auth/session/refresh (FR-13)', () => {
  const refresh = () =>
    world
      .post('refresh')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', SESSION_COOKIES);

  it('answers the session shape from the cookies alone, with no Authorization header', async () => {
    const ada = await registerAda(world);
    const access = accessToken();
    client.refresh.mockResolvedValue({
      accessToken: access,
      idToken: idToken(),
    });

    const res = await refresh().expect(200);

    expect(client.refresh).toHaveBeenCalledWith(REFRESH_TOKEN, USERNAME);
    expect(res.body.data).toEqual({
      accessToken: access,
      expiresIn: expect.any(Number),
      user: expect.objectContaining({ id: ada.id, email: ADA.email }),
    });
    expect(res.body.data.expiresIn).toBeGreaterThan(ACCESS_TOKEN_TTL_S - 60);
    expect(res.body.data.expiresIn).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_S);
    expect(res.text).not.toContain(REFRESH_TOKEN);
    // No rotation from Cognito: the cookies are kept as they are.
    expectUntouched(res);
  });

  it('rotates qa_rt when Cognito returns a new refresh token', async () => {
    await registerAda(world);
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(),
      refreshToken: 'rotated-refresh-token',
    });

    const res = await refresh().expect(200);

    const cookies = cookiesOf(res);
    expect(cookies.find((c) => c.name === 'qa_rt')?.value).toBe(
      'rotated-refresh-token',
    );
    expect(cookies.find((c) => c.name === 'qa_ru')?.value).toBe(USERNAME);
    for (const cookie of cookies) {
      expect(cookie.attrs).toContain(`Path=${SESSION_PATH}`);
    }
  });

  it('re-checks admission in the database, not the cache: a revoked last role → 403 and both cookies cleared', async () => {
    const ada = await registerAda(world);
    const cacheRead = vi.spyOn(world.cache, 'getBySub');
    const assignment = await world.assignments.create({
      userId: ada.id,
      roleCode: 'TPB',
    });
    // Ada's other role (ADMIN) is revoked too: no live assignment is left.
    await world.assignments.revoke(assignment.id, ada.id);
    await world.assignments.revoke(adminAssignmentId, ada.id);
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(),
    });

    const res = await refresh();

    expectEnvelope(res, 403);
    expectCleared(res);
    expect(cacheRead).not.toHaveBeenCalled();
  });

  it('never creates a user: an unknown SSO identity → 403, cleared, no row written', async () => {
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(true),
    });

    const res = await refresh();

    expectEnvelope(res, 403);
    expectCleared(res);
    expect(await world.users.findByEmail(ADA.email)).toBeUndefined();
  });

  it('an email collision (409) → both cookies cleared, so the refusal does not repeat forever', async () => {
    // Another account (another sub) already holds Ada's email.
    await world.users.create({
      email: ADA.email,
      cognitoSub: 'sub-someone-else',
      authSource: 'custom',
      firstName: 'Other',
      lastName: 'Person',
    });
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(),
    });

    const res = await refresh();

    expectEnvelope(res, 409);
    expectCleared(res);
  });

  it('a deactivated user → 403 and both cookies cleared', async () => {
    const ada = await registerAda(world);
    ada.isActive = false;
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(),
    });

    const res = await refresh();

    expectEnvelope(res, 403);
    expectCleared(res);
  });

  it.each([
    ['no Origin', undefined],
    ['another origin', 'https://evil.example.com'],
    ['the allowed origin with a trailing slash', `${ALLOWED_ORIGIN}/`],
  ])(
    '%s → 403, Cognito not called, cookies untouched',
    async (_label, origin) => {
      let req = world.post('refresh').set('Cookie', SESSION_COOKIES);
      if (origin !== undefined) req = req.set('Origin', origin);

      const res = await req;

      expectEnvelope(res, 403);
      expectUntouched(res);
      expect(client.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no cookies', undefined],
    ['only qa_rt', `qa_rt=${REFRESH_TOKEN}`],
    ['only qa_ru', `qa_ru=${USERNAME}`],
    ['empty values', 'qa_rt=; qa_ru='],
  ])(
    '%s → 401 and both cookies cleared, Cognito not called',
    async (_label, cookie) => {
      let req = world.post('refresh').set('Origin', ALLOWED_ORIGIN);
      if (cookie !== undefined) req = req.set('Cookie', cookie);

      const res = await req;

      expectEnvelope(res, 401);
      expectCleared(res);
      expect(client.refresh).not.toHaveBeenCalled();
    },
  );

  it('Cognito refuses the refresh → 401 and both cookies cleared', async () => {
    client.refresh.mockRejectedValue(new InvalidCredentialsError());

    const res = await refresh();

    expectEnvelope(res, 401);
    expectCleared(res);
  });

  it('Cognito unavailable → 503 and the cookies are kept (an outage does not end the session)', async () => {
    client.refresh.mockRejectedValue(new UpstreamUnavailableError());

    const res = await refresh();

    expectEnvelope(res, 503);
    expectUntouched(res);
  });

  it('a token that fails verification → 401 and both cookies cleared', async () => {
    client.refresh.mockResolvedValue({
      accessToken: 'not.a.jwt',
      idToken: idToken(),
    });

    const res = await refresh();

    expectEnvelope(res, 401);
    expectCleared(res);
  });

  it('accepts a JSON body and an empty JSON object (what an HTTP client may send)', async () => {
    await registerAda(world);
    client.refresh.mockResolvedValue({
      accessToken: accessToken(),
      idToken: idToken(),
    });

    await refresh()
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(200);
  });
});

describe('POST /auth/session/logout (FR-14)', () => {
  it('revokes the refresh token, clears both cookies and answers 204, without an access token', async () => {
    client.revoke.mockResolvedValue(undefined);

    const res = await world
      .post('logout')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', SESSION_COOKIES)
      .expect(204);

    expect(client.revoke).toHaveBeenCalledWith(REFRESH_TOKEN);
    expect(res.text).toBe('');
    expectCleared(res);
  });

  it('still clears the cookies and answers 204 when Cognito fails to revoke', async () => {
    client.revoke.mockRejectedValue(new UpstreamUnavailableError());

    const res = await world
      .post('logout')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', SESSION_COOKIES)
      .expect(204);

    expectCleared(res);
  });

  it('without cookies: nothing to revoke, 204 and cleared', async () => {
    const res = await world
      .post('logout')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(204);

    expect(client.revoke).not.toHaveBeenCalled();
    expectCleared(res);
  });

  it.each([
    ['no Origin', undefined],
    ['another origin', 'https://evil.example.com'],
  ])('%s → 403, cookies untouched, nothing revoked', async (_label, origin) => {
    let req = world.post('logout').set('Cookie', SESSION_COOKIES);
    if (origin !== undefined) req = req.set('Origin', origin);

    const res = await req;

    expectEnvelope(res, 403);
    expectUntouched(res);
    expect(client.revoke).not.toHaveBeenCalled();
  });
});
