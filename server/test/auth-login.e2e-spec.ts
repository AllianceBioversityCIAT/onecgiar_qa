import {
  Controller,
  HttpCode,
  Logger,
  Module,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  ADMISSION_UNIT_OF_WORK,
  AdmissionService,
  type AdmissionUnitOfWork,
} from '../src/auth/admission.service.js';
import {
  CognitoAuthClient,
  InvalidCredentialsError,
  UpstreamUnavailableError,
} from '../src/auth/cognito-auth.client.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import type { User } from '../src/database/drizzle/schema/index.js';
import { CURRENT_USER_CLOCK } from '../src/users/current-user.cache.js';
import { ROLE_DEFINITIONS } from '../src/users/permissions.js';
import {
  ROLE_ASSIGNMENTS_STORE,
  RoleAssignmentsRepository,
} from '../src/users/role-assignments.repository.js';
import { DuplicateUserError } from '../src/users/users.errors.js';
import { USERS_STORE, UsersRepository } from '../src/users/users.repository.js';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from './support/in-memory-stores.js';
import {
  localJwksCache,
  newKeyPair,
  signJwt,
} from './support/jwt-test-keys.js';

// Login, complete-new-password, provider-url and callback (FR-4 to FR-9, NFR-3,
// NFR-4, NFR-7) over the real app. Only the edges are replaced: the
// Cognito client is a fake (so "never called" is observable), the
// verifier is the real one over a locally generated key set (real RS256
// tokens, no network) and the database ports are the in-memory fakes. The
// cookie names, Path and Max-Age below are written out on purpose: a test that
// imported them from the code under test could not catch a wrong value.

const REGION = process.env.COGNITO_REGION!;
const POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGINS!;
const REDIRECT_URI = `${ALLOWED_ORIGIN}/auth/callback`;
const KID = 'login-e2e-kid';

const signer = newKeyPair(KID);

// Values the response bodies and the logs must never carry.
const PASSWORD = 'P@ssw0rd-login-SECRET';
const NEW_PASSWORD = 'N3w-P@ssw0rd-SECRET';
const SESSION = 'cognito-session-SECRET';
const CODE = 'auth-code-SECRET';
const REFRESH_TOKEN = 'refresh-token-SECRET.part2.part3';
const USERNAME = 'cog-username-SECRET';

const BAD_REDIRECT_URIS: Array<[string, string]> = [
  [
    'a host that only starts like the allowed one',
    `${ALLOWED_ORIGIN}.evil.com/cb`,
  ],
  ['credentials that hide another host', 'https://qa.example.org@evil.com/cb'],
  ['credentials on the allowed host', 'https://user:pw@qa.example.org/cb'],
  [
    'a backslash that hides another host',
    'https://qa.example.org\\@evil.com/cb',
  ],
  ['another origin', 'https://evil.com/cb'],
  [
    'the allowed origin only in the query',
    `https://evil.com/cb?next=${ALLOWED_ORIGIN}`,
  ],
  ['http instead of https', 'http://qa.example.org/cb'],
  ['another port', 'https://qa.example.org:8443/cb'],
  ['a protocol-relative URL', '//qa.example.org/cb'],
  ['a relative URL', '/auth/callback'],
  ['a bare host', 'qa.example.org/cb'],
  ['a javascript URL', 'javascript:alert(1)'],
];

const SESSION_PATH = '/api/v1/auth/session';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const ACCESS_TOKEN_TTL_S = 1800;

const nowSeconds = () => Math.floor(Date.now() / 1000);

interface Identity {
  sub: string;
  email: string;
  /** `undefined`: the default username; `null`: the token has no `cognito:username`. */
  username?: string | null;
  /** Defaults to true. */
  emailVerified?: boolean;
  sso?: boolean;
}

const ada: Identity = { sub: 'sub-ada', email: 'ada@cgiar.org' };

function idTokenOf(who: Identity): string {
  return signJwt(
    {
      sub: who.sub,
      iss: ISSUER,
      aud: CLIENT_ID,
      token_use: 'id',
      ...(who.username === null
        ? {}
        : { 'cognito:username': who.username ?? USERNAME }),
      email: who.email,
      ...(who.emailVerified === false ? {} : { email_verified: true }),
      ...(who.sso
        ? { identities: [{ providerName: 'CGIAR-AzureAD', userId: who.email }] }
        : {}),
      given_name: 'Ada',
      family_name: 'Lovelace',
      auth_time: nowSeconds(),
      iat: nowSeconds(),
      // Not the access token's expiry: `expiresIn` must follow the access token.
      exp: nowSeconds() + 3000,
    },
    signer,
  );
}

function accessTokenOf(who: Identity): string {
  return signJwt(
    {
      sub: who.sub,
      iss: ISSUER,
      client_id: CLIENT_ID,
      token_use: 'access',
      scope: 'aws.cognito.signin.user.admin',
      username: who.username ?? USERNAME,
      auth_time: nowSeconds(),
      iat: nowSeconds(),
      exp: nowSeconds() + ACCESS_TOKEN_TTL_S,
      jti: `jti-${who.sub}`,
    },
    signer,
  );
}

function tokensOf(who: Identity) {
  return {
    accessToken: accessTokenOf(who),
    idToken: idTokenOf(who),
    refreshToken: REFRESH_TOKEN,
  };
}

const client = {
  loginCustom: vi.fn(),
  completeNewPassword: vi.fn(),
  providerUrl: vi.fn(),
  validateCode: vi.fn(),
  refresh: vi.fn(),
};

// --- Body probes ----------------------------------------------------------------

const echoBody = (req: Request) => ({ body: (req.body as unknown) ?? null });

/**
 * Echoes what the body parsers left on the request, so a test can see whether
 * a body under /api/v1/auth was parsed at all. The JSON-only rule covers POST
 * only (FR-4), so a PUT reaches the parsers whatever its media type: through
 * it the probe sees the parser layer on its own.
 */
@Public()
@Controller('auth/body-probe')
class AuthBodyProbeController {
  @Put()
  put(@Req() req: Request) {
    return echoBody(req);
  }

  @HttpCode(200)
  @Post()
  post(@Req() req: Request) {
    return echoBody(req);
  }
}

/** The same probe outside /api/v1/auth: the control that a probe sees a parsed form. */
@Public()
@Controller('body-probe')
class BodyProbeController {
  @Put()
  put(@Req() req: Request) {
    return echoBody(req);
  }
}

@Module({ controllers: [AuthBodyProbeController, BodyProbeController] })
class BodyProbeModule {}

interface World {
  app: NestExpressApplication;
  usersStore: InMemoryUsersStore;
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
  admission: () => AdmissionService;
  post(path: string, body?: unknown): request.Test;
  get(path: string): request.Test;
  /**
   * A request whose body goes out byte for byte with exactly this
   * `Content-Type` (`null`: no `Content-Type` header at all). `url` is the
   * full path, prefix included.
   */
  raw(
    method: 'post' | 'put',
    url: string,
    contentType: string | null,
    body: string,
  ): request.Test;
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
  // One "transaction" over the in-memory stores (no rollback: admission writes
  // nothing before it has decided to admit).
  const unitOfWork: AdmissionUnitOfWork = {
    run: (work) => work({ users, assignments }),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, BodyProbeModule],
  })
    .overrideProvider(CognitoAuthClient)
    .useValue(client)
    .overrideProvider(USERS_STORE)
    .useValue(usersStore)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(assignmentsStore)
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
    usersStore,
    users,
    assignments,
    admission: () => moduleRef.get(AdmissionService, { strict: false }),
    post: (path, body) => {
      const req = request(app.getHttpServer()).post(`/api/v1${path}`);
      return body === undefined ? req : req.send(body as object);
    },
    get: (path) => request(app.getHttpServer()).get(`/api/v1${path}`),
    raw: (method, url, contentType, body) => {
      const req = request(app.getHttpServer())[method](url);
      if (contentType !== null) req.set('Content-Type', contentType);
      // superagent labels a bare string as a form when no type is set, and
      // serializes a Buffer under a JSON type: a string goes out under a
      // non-empty type, a Buffer (sent as is, unlabeled) otherwise.
      return contentType ? req.send(body) : req.send(Buffer.from(body));
    },
    close: () => app.close(),
  };
}

/** A custom user as an admin would leave it: registered, with an ADMIN assignment. */
async function registerCustom(
  world: World,
  options: {
    who?: Identity;
    linked?: boolean;
    isActive?: boolean;
    withRole?: boolean;
  } = {},
): Promise<User> {
  const who = options.who ?? ada;
  const user = await world.users.create({
    email: who.email,
    cognitoSub: options.linked === false ? null : who.sub,
    authSource: 'custom',
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
  if (options.isActive === false) user.isActive = false;
  if (options.withRole !== false) {
    await world.assignments.create({ userId: user.id, roleCode: 'ADMIN' });
  }
  return user;
}

// --- Set-Cookie helpers -----------------------------------------------------

const rawCookies = (res: request.Response): string[] => {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
};

interface ParsedCookie {
  name: string;
  value: string;
  attrs: string[];
}

function parseCookie(raw: string): ParsedCookie {
  const [pair, ...attrs] = raw.split('; ');
  const eq = pair.indexOf('=');
  return {
    name: pair.slice(0, eq),
    value: decodeURIComponent(pair.slice(eq + 1)),
    attrs,
  };
}

const cookiesOf = (res: request.Response) => rawCookies(res).map(parseCookie);

/** Asserts every attribute of both session cookies, one by one (FR-9, DD-3). */
function expectSessionCookies(res: request.Response) {
  const cookies = cookiesOf(res);
  expect(cookies.map((c) => c.name).sort()).toEqual(['qa_rt', 'qa_ru']);
  for (const cookie of cookies) {
    const label = `cookie ${cookie.name}`;
    expect(cookie.attrs, `${label}: HttpOnly`).toContain('HttpOnly');
    expect(cookie.attrs, `${label}: Secure`).toContain('Secure');
    expect(cookie.attrs, `${label}: SameSite`).toContain('SameSite=Lax');
    expect(cookie.attrs, `${label}: Path`).toContain(`Path=${SESSION_PATH}`);
    expect(cookie.attrs, `${label}: Max-Age`).toContain(
      `Max-Age=${THIRTY_DAYS_S}`,
    );
    expect(
      cookie.attrs.some((a) => /^domain\b/i.test(a)),
      `${label}: host-only (no Domain)`,
    ).toBe(false);
  }
  return {
    refresh: cookies.find((c) => c.name === 'qa_rt')!,
    username: cookies.find((c) => c.name === 'qa_ru')!,
  };
}

/**
 * Anything but a successful login leaves an existing session cookie untouched:
 * neither set, replaced nor cleared, so no `Set-Cookie` header at all (FR-9).
 */
function expectNoSetCookie(res: request.Response) {
  expect(res.headers['set-cookie'], 'Set-Cookie header').toBeUndefined();
}

/** The session a browser may already hold when a new login fails. */
const PREVIOUS_SESSION_COOKIE = 'qa_rt=previous-refresh; qa_ru=previous-user';

// --- Envelope and leak helpers ------------------------------------------------

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
}

/** No secret of the flow appears anywhere in what the caller receives. */
function expectNoSecrets(res: request.Response, extra: string[] = []) {
  for (const secret of [
    REFRESH_TOKEN,
    USERNAME,
    PASSWORD,
    NEW_PASSWORD,
    ...extra,
  ]) {
    expect(res.text, 'response body').not.toContain(secret);
  }
}

/** A refusal by admission or credentials: envelope, no `Set-Cookie`, no tokens. */
function expectRefusal(
  res: request.Response,
  status: 401 | 403 | 409,
  code?: string,
) {
  expectEnvelope(res, status, code);
  expectNoSetCookie(res);
  expect(res.body).not.toHaveProperty('data');
  expect(JSON.stringify(res.body)).not.toContain('accessToken');
  expectNoSecrets(res);
}

// --- Log capture ----------------------------------------------------------------

const logged: string[] = [];

function captureLogs() {
  logged.length = 0;
  const record = (...args: unknown[]) => {
    logged.push(
      args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' '),
    );
  };
  for (const level of [
    'log',
    'warn',
    'error',
    'debug',
    'verbose',
    'fatal',
  ] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(record);
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(record);
  }
  // Also what reaches stdout or stderr without a `Logger` instance (the static
  // `Logger`, a `ConsoleLogger`, a stray write): a leak has no other way out.
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      logged.push(
        typeof chunk === 'string'
          ? chunk
          : Buffer.from(chunk as Uint8Array).toString('utf8'),
      );
      return true;
    }) as never);
  }
}

interface Decision {
  event: string;
  route: string;
  outcome: string;
  status: number;
  reason: string;
  userId?: number;
  requestId: string;
}

const decisions = (): Decision[] =>
  logged
    .filter((line) => line.includes('"event":"auth_decision"'))
    .map((line) => JSON.parse(line) as Decision);

// --- Unexpected failures ------------------------------------------------------------

/** A user whose failed write must not reach any output: its sub and email are markers. */
const marked: Identity = {
  sub: 'sub-leak-marker-7f3a',
  email: 'email-leak-marker-7f3a@cgiar.org',
};

/**
 * A MySQL failure as drizzle-orm 0.45 raises it: a real `DrizzleQueryError`,
 * whose message is `Failed query: …\nparams: …`, over the mysql2 error. As in
 * a failed write of the user row, the params hold the username, the email and
 * the sub; the driver's own texts carry them too.
 */
function dbFailure(who: Identity): DrizzleQueryError {
  const driver = Object.assign(
    new Error(
      `Lock wait timeout exceeded; try restarting transaction (${who.email})`,
    ),
    {
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
      sqlState: 'HY000',
      sqlMessage: `Lock wait timeout exceeded for ${USERNAME}`,
      sql: `update users set cognito_username = '${USERNAME}', email = '${who.email}' where cognito_sub = '${who.sub}'`,
    },
  );
  return new DrizzleQueryError(
    'update `users` set `cognito_username` = ?, `email` = ?, `last_login_at` = ? where `users`.`cognito_sub` = ?',
    [USERNAME, who.email, new Date(), who.sub],
    driver,
  );
}

interface Unhandled {
  event: string;
  requestId: string;
  [field: string]: unknown;
}

const unhandledLines = (): Unhandled[] =>
  logged
    .filter((line) => line.includes('"event":"unhandled_error"'))
    .map((line) => JSON.parse(line) as Unhandled);

// ----------------------------------------------------------------------------------

describe('Login, session issuance and throttling (e2e)', () => {
  let world: World;

  beforeEach(async () => {
    for (const fn of Object.values(client)) fn.mockReset();
    // Silences the app's own output (a 503 is logged as an error) and keeps it
    // for the log assertions.
    captureLogs();
    world = await buildWorld();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  const loginBody = { email: ada.email, password: PASSWORD };
  const newPasswordBody = {
    email: ada.email,
    newPassword: NEW_PASSWORD,
    session: SESSION,
  };
  const callbackBody = { code: CODE, redirectUri: REDIRECT_URI };

  describe('POST /auth/login: success (FR-4, FR-9)', () => {
    let tokens: ReturnType<typeof tokensOf>;

    beforeEach(async () => {
      await registerCustom(world);
      tokens = tokensOf(ada);
      client.loginCustom.mockResolvedValue({ kind: 'tokens', tokens });
    });

    it('answers 200 with { accessToken, expiresIn, user } and calls Cognito once', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);

      expect(Object.keys(res.body.data).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'user',
      ]);
      expect(res.body.data.accessToken).toBe(tokens.accessToken);
      // The access token's remaining life, not the id token's (3000 s) nor a constant.
      expect(res.body.data.expiresIn).toBeGreaterThan(ACCESS_TOKEN_TTL_S - 10);
      expect(res.body.data.expiresIn).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_S);
      expect(res.body.data.user).toMatchObject({
        email: ada.email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        authSource: 'custom',
        assignments: [{ role: 'ADMIN' }],
      });
      expect(client.loginCustom).toHaveBeenCalledTimes(1);
      expect(client.loginCustom).toHaveBeenCalledWith(ada.email, PASSWORD);
    });

    it('returns the same user shape as GET /auth/me', async () => {
      const login = await world.post('/auth/login', loginBody).expect(200);
      const me = await world
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .expect(200);
      expect(login.body.data.user).toEqual(me.body.data);
    });

    it('sets qa_rt with the refresh token and qa_ru with the cognito:username claim', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      const { refresh, username } = expectSessionCookies(res);
      expect(refresh.value).toBe(REFRESH_TOKEN);
      expect(username.value).toBe(USERNAME);
    });

    it('carries neither the refresh token, the id token nor the username in the body', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      expectNoSecrets(res, [tokens.idToken]);
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(res.body).not.toHaveProperty('idToken');
      expect(JSON.stringify(res.body)).not.toContain(tokens.idToken);
    });

    it('answers every request with an x-request-id header', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      expect(res.headers['x-request-id']).toEqual(
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      );
      const echoed = await world
        .post('/auth/login', loginBody)
        .set('x-request-id', 'trace-123');
      expect(echoed.headers['x-request-id']).toBe('trace-123');
    });
  });

  describe('POST /auth/login: first-login challenge (FR-4)', () => {
    beforeEach(() => {
      client.loginCustom.mockResolvedValue({
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
    });

    it('answers 200 with the challenge and the session, and no tokens', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      expect(res.body.data).toEqual({
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
    });

    it('sets no cookie at all', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('does not evaluate admission: an unregistered user gets the challenge and no row is touched', async () => {
      const res = await world.post('/auth/login', loginBody).expect(200);
      expect(res.body.data.challenge).toBe('NEW_PASSWORD_REQUIRED');
      expect(world.usersStore.rows).toHaveLength(0);
      expect(world.usersStore.writes).toBe(0);
    });
  });

  describe('POST /auth/login: refusals (FR-4, FR-8, FR-9)', () => {
    it('answers 401 with the envelope when Cognito rejects the credentials', async () => {
      client.loginCustom.mockRejectedValue(new InvalidCredentialsError());
      const res = await world.post('/auth/login', loginBody);
      expectRefusal(res, 401);
    });

    it('does not reveal whether the email exists', async () => {
      await registerCustom(world);
      client.loginCustom.mockRejectedValue(new InvalidCredentialsError());
      const known = await world.post('/auth/login', loginBody);
      const unknown = await world.post('/auth/login', {
        email: 'nobody@cgiar.org',
        password: PASSWORD,
      });
      expect(known.status).toBe(401);
      expect(unknown.status).toBe(401);
      // Same code and message for both; only the meta differs.
      expect(unknown.body.error).toEqual(known.body.error);
      expect(known.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('answers 503 with the envelope and no cookie when Cognito is unavailable', async () => {
      client.loginCustom.mockRejectedValue(new UpstreamUnavailableError());
      const res = await world.post('/auth/login', loginBody);
      expectEnvelope(res, 503, 'AUTH_SERVICE_UNAVAILABLE');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    describe('admission refusals reach the client through the filter, and touch no cookie', () => {
      it('403: a custom user not registered in QA, and no row is created', async () => {
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });
        const res = await world.post('/auth/login', loginBody);
        expectRefusal(res, 403, 'AUTH_USER_NOT_REGISTERED');
        // What the form can show as is.
        expect(res.body.error.message).toBe(
          'Your account is not registered in QA. Ask an administrator for access.',
        );
        expect(world.usersStore.rows).toHaveLength(0);
      });

      it('403: an inactive user', async () => {
        await registerCustom(world, { isActive: false });
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });
        expectRefusal(
          await world.post('/auth/login', loginBody),
          403,
          'AUTH_USER_INACTIVE',
        );
      });

      it('403: a custom user without an active assignment', async () => {
        await registerCustom(world, { withRole: false });
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });
        expectRefusal(
          await world.post('/auth/login', loginBody),
          403,
          'AUTH_NO_ACTIVE_ROLES',
        );
      });

      it('403: an unverified email must not link a pre-registered user', async () => {
        const user = await registerCustom(world, { linked: false });
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf({ ...ada, emailVerified: false }),
        });
        expectRefusal(
          await world.post('/auth/login', loginBody),
          403,
          'AUTH_EMAIL_NOT_VERIFIED',
        );
        expect(user.cognitoSub).toBeNull();
      });

      it('409: the email belongs to a user with another sub, and nothing is linked or created', async () => {
        const other = { ...ada, sub: 'sub-someone-else' };
        const user = await registerCustom(world, { who: other });
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });
        expectRefusal(
          await world.post('/auth/login', loginBody),
          409,
          'AUTH_EMAIL_CONFLICT',
        );
        expect(world.usersStore.rows).toHaveLength(1);
        expect(user.cognitoSub).toBe('sub-someone-else');
      });

      it('409: a duplicate-user error from admission', async () => {
        await registerCustom(world);
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });
        vi.spyOn(world.admission(), 'resolve').mockRejectedValue(
          new DuplicateUserError(),
        );
        expectRefusal(await world.post('/auth/login', loginBody), 409);
      });
    });

    it('401, fail closed: an id token without cognito:username sets no cookie', async () => {
      await registerCustom(world);
      const who = { ...ada, username: null };
      client.loginCustom.mockResolvedValue({
        kind: 'tokens',
        tokens: tokensOf(who),
      });
      const res = await world.post('/auth/login', loginBody);
      expectRefusal(res, 401);
    });

    it('401: an access token that is not valid for the QA client', async () => {
      await registerCustom(world);
      client.loginCustom.mockResolvedValue({
        kind: 'tokens',
        tokens: { ...tokensOf(ada), accessToken: 'not-a-jwt' },
      });
      expectRefusal(await world.post('/auth/login', loginBody), 401);
    });
  });

  describe('POST /auth/login: validation (NFR-3, FR-4)', () => {
    const invalid: Array<[string, unknown]> = [
      ['a missing email', { password: PASSWORD }],
      ['a malformed email', { email: 'not-an-email', password: PASSWORD }],
      ['an email that is not a string', { email: 42, password: PASSWORD }],
      [
        'an email longer than 255 characters',
        { email: `${'a'.repeat(250)}@cgiar.org`, password: PASSWORD },
      ],
      ['a missing password', { email: ada.email }],
      ['an empty password', { email: ada.email, password: '' }],
      [
        'a password that is not a string',
        { email: ada.email, password: [PASSWORD] },
      ],
      [
        'an unknown extra field',
        { email: ada.email, password: PASSWORD, role: 'ADMIN' },
      ],
      ['an empty object', {}],
      ['an array instead of an object', []],
    ];

    it.each(invalid)(
      '400 before Cognito is called: %s',
      async (_name, body) => {
        const res = await world.post('/auth/login', body);
        expectEnvelope(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.fields).toEqual(expect.any(Array));
        expect(res.body.error.fields.length).toBeGreaterThan(0);
        expect(res.headers['set-cookie']).toBeUndefined();
        expectNoSecrets(res);
        expect(client.loginCustom).not.toHaveBeenCalled();
      },
    );

    it('400 before Cognito is called: no body at all', async () => {
      const res = await world.post('/auth/login');
      expectEnvelope(res, 400);
      expect(client.loginCustom).not.toHaveBeenCalled();
    });

    it('400 VALIDATION_FAILED tells the form, field by field, what to fix', async () => {
      const res = await world.post('/auth/login', {
        email: 'not-an-email',
        isAdmin: true,
      });
      expectEnvelope(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toHaveLength(3);
      expect(res.body.error.fields).toEqual(
        expect.arrayContaining([
          {
            field: 'email',
            code: 'INVALID_EMAIL',
            message: 'Enter a valid email address.',
          },
          {
            field: 'password',
            code: 'REQUIRED',
            message: 'This field is required.',
          },
          {
            field: 'isAdmin',
            code: 'UNKNOWN_FIELD',
            message: 'This field is not allowed.',
          },
        ]),
      );
      expect(res.text).not.toMatch(/must be|should not exist/);
      expect(client.loginCustom).not.toHaveBeenCalled();
    });

    it('400 before Cognito is called: malformed JSON', async () => {
      const res = await world
        .post('/auth/login')
        .set('content-type', 'application/json')
        .send('{"email":');
      expectEnvelope(res, 400, 'MALFORMED_JSON');
      expect(res.text).not.toMatch(/Unexpected|JSON\.parse|position/);
      expect(client.loginCustom).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/complete-new-password (FR-5)', () => {
    it('completes the challenge, then answers the session shape with both cookies', async () => {
      await registerCustom(world);
      const tokens = tokensOf(ada);
      client.completeNewPassword.mockResolvedValue(tokens);

      const res = await world
        .post('/auth/complete-new-password', newPasswordBody)
        .expect(200);

      expect(client.completeNewPassword).toHaveBeenCalledWith(
        ada.email,
        NEW_PASSWORD,
        SESSION,
      );
      expect(Object.keys(res.body.data).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'user',
      ]);
      expect(res.body.data.user.assignments).toEqual([{ role: 'ADMIN' }]);
      const { refresh, username } = expectSessionCookies(res);
      expect(refresh.value).toBe(REFRESH_TOKEN);
      expect(username.value).toBe(USERNAME);
      expectNoSecrets(res, [tokens.idToken, SESSION]);
    });

    it('403 and no Set-Cookie when the user is not registered in QA (the Cognito password change stays)', async () => {
      client.completeNewPassword.mockResolvedValue(tokensOf(ada));
      const res = await world.post(
        '/auth/complete-new-password',
        newPasswordBody,
      );
      expectRefusal(res, 403);
      expect(client.completeNewPassword).toHaveBeenCalledTimes(1);
      expect(world.usersStore.rows).toHaveLength(0);
    });

    it('403 and no Set-Cookie when the user has no active assignment', async () => {
      await registerCustom(world, { withRole: false });
      client.completeNewPassword.mockResolvedValue(tokensOf(ada));
      expectRefusal(
        await world.post('/auth/complete-new-password', newPasswordBody),
        403,
      );
    });

    it('401 when Cognito refuses the completion', async () => {
      client.completeNewPassword.mockRejectedValue(
        new InvalidCredentialsError(),
      );
      expectRefusal(
        await world.post('/auth/complete-new-password', newPasswordBody),
        401,
      );
    });

    it('503 when Cognito is unavailable during the completion', async () => {
      // A further challenge (MFA) is a 401 in the client itself (T-6 unit tests).
      client.completeNewPassword.mockRejectedValue(
        new UpstreamUnavailableError(),
      );
      const res = await world.post(
        '/auth/complete-new-password',
        newPasswordBody,
      );
      expectEnvelope(res, 503);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    const invalid: Array<[string, unknown]> = [
      ['a missing session', { email: ada.email, newPassword: NEW_PASSWORD }],
      [
        'an empty session',
        { email: ada.email, newPassword: NEW_PASSWORD, session: '' },
      ],
      ['a missing newPassword', { email: ada.email, session: SESSION }],
      [
        'an empty newPassword',
        { email: ada.email, newPassword: '', session: SESSION },
      ],
      [
        'a malformed email',
        { email: 'nope', newPassword: NEW_PASSWORD, session: SESSION },
      ],
      ['an unknown extra field', { ...newPasswordBody, isAdmin: true }],
    ];

    it.each(invalid)(
      '400 before Cognito is called: %s',
      async (_name, body) => {
        const res = await world.post('/auth/complete-new-password', body);
        expectEnvelope(res, 400);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(client.completeNewPassword).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /auth/provider-url (FR-6)', () => {
    it('answers 200 { url } for an allowed redirect URI and passes it to Cognito', async () => {
      client.providerUrl.mockResolvedValue('https://idp.example/authorize?x=1');
      const res = await world
        .get('/auth/provider-url')
        .query({ redirectUri: REDIRECT_URI })
        .expect(200);
      expect(res.body.data).toEqual({
        url: 'https://idp.example/authorize?x=1',
      });
      expect(client.providerUrl).toHaveBeenCalledWith(REDIRECT_URI);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it.each([
      ALLOWED_ORIGIN,
      `${ALLOWED_ORIGIN}/`,
      `${ALLOWED_ORIGIN}/auth/callback?next=%2Fhome`,
    ])('accepts %s', async (redirectUri) => {
      client.providerUrl.mockResolvedValue('https://idp.example/authorize');
      await world.get('/auth/provider-url').query({ redirectUri }).expect(200);
      expect(client.providerUrl).toHaveBeenCalledWith(redirectUri);
    });

    it.each(BAD_REDIRECT_URIS)(
      '400 and no Cognito call for %s',
      async (_name, redirectUri) => {
        const res = await world
          .get('/auth/provider-url')
          .query({ redirectUri });
        expectEnvelope(res, 400);
        expect(client.providerUrl).not.toHaveBeenCalled();
      },
    );

    it('400 and no Cognito call without a redirect URI', async () => {
      expectEnvelope(await world.get('/auth/provider-url'), 400);
      expect(client.providerUrl).not.toHaveBeenCalled();
    });

    it('400 and no Cognito call for an empty redirect URI', async () => {
      const res = await world
        .get('/auth/provider-url')
        .query({ redirectUri: '' });
      expectEnvelope(res, 400);
      expect(client.providerUrl).not.toHaveBeenCalled();
    });

    it('400 and no Cognito call for an unknown query parameter', async () => {
      const res = await world
        .get('/auth/provider-url')
        .query({ redirectUri: REDIRECT_URI, provider: 'other' });
      expectEnvelope(res, 400);
      expect(client.providerUrl).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/callback (FR-7)', () => {
    const sso: Identity = {
      sub: 'sub-sso-ana',
      email: 'ana@cgiar.org',
      sso: true,
    };

    it('exchanges the code and creates a GUEST on the first SSO login, with both cookies', async () => {
      const tokens = tokensOf(sso);
      client.validateCode.mockResolvedValue(tokens);

      const res = await world.post('/auth/callback', callbackBody).expect(200);

      expect(client.validateCode).toHaveBeenCalledWith(CODE, REDIRECT_URI);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'user',
      ]);
      expect(res.body.data.user).toMatchObject({
        email: sso.email,
        authSource: 'sso',
        assignments: [],
      });
      const { refresh, username } = expectSessionCookies(res);
      expect(refresh.value).toBe(REFRESH_TOKEN);
      expect(username.value).toBe(USERNAME);
      expectNoSecrets(res, [tokens.idToken, CODE]);
    });

    it('401 and no Set-Cookie for an invalid or reused code', async () => {
      client.validateCode.mockRejectedValue(
        new InvalidCredentialsError('AUTH_SSO_CODE_INVALID'),
      );
      expectRefusal(
        await world.post('/auth/callback', callbackBody),
        401,
        'AUTH_SSO_CODE_INVALID',
      );
    });

    it('409 and no Set-Cookie when the SSO email belongs to another sub', async () => {
      await registerCustom(world, {
        who: { ...sso, sub: 'sub-someone-else' },
      });
      client.validateCode.mockResolvedValue(tokensOf(sso));
      expectRefusal(await world.post('/auth/callback', callbackBody), 409);
    });

    it('403 and no Set-Cookie for an inactive SSO user', async () => {
      await registerCustom(world, { who: sso, isActive: false });
      client.validateCode.mockResolvedValue(tokensOf(sso));
      expectRefusal(await world.post('/auth/callback', callbackBody), 403);
    });

    it.each(BAD_REDIRECT_URIS)(
      '400 and no Cognito call for the redirect URI %s',
      async (_name, redirectUri) => {
        const res = await world.post('/auth/callback', {
          code: CODE,
          redirectUri,
        });
        expectEnvelope(res, 400);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(client.validateCode).not.toHaveBeenCalled();
      },
    );

    const invalid: Array<[string, unknown]> = [
      ['a missing code', { redirectUri: REDIRECT_URI }],
      ['an empty code', { code: '', redirectUri: REDIRECT_URI }],
      ['a code that is not a string', { code: 7, redirectUri: REDIRECT_URI }],
      ['a missing redirectUri', { code: CODE }],
      ['an unknown extra field', { ...callbackBody, state: 'x' }],
    ];

    it.each(invalid)(
      '400 before Cognito is called: %s',
      async (_name, body) => {
        const res = await world.post('/auth/callback', body);
        expectEnvelope(res, 400);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(client.validateCode).not.toHaveBeenCalled();
      },
    );
  });

  describe('JSON only, against login CSRF (FR-4, FR-5, FR-7)', () => {
    const BOUNDARY = 'qa-e2e-boundary';
    const asForm = (body: Record<string, string>) =>
      new URLSearchParams(body).toString();
    const asJson = (body: Record<string, string>) => JSON.stringify(body);
    const asMultipart = (body: Record<string, string>) =>
      Object.entries(body)
        .map(
          ([name, value]) =>
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('') + `--${BOUNDARY}--\r\n`;

    // What a cross-site page can send without a CORS preflight (a form, or
    // fetch with a "simple" type), plus types that only look like JSON.
    const refused: Array<
      [string, string | null, (body: Record<string, string>) => string]
    > = [
      [
        'an HTML form (application/x-www-form-urlencoded)',
        'application/x-www-form-urlencoded',
        asForm,
      ],
      ['a text/plain body that is JSON', 'text/plain', asJson],
      [
        'a multipart form',
        `multipart/form-data; boundary=${BOUNDARY}`,
        asMultipart,
      ],
      [
        'a type that only starts like JSON (application/json-foo)',
        'application/json-foo',
        asJson,
      ],
      ['an empty Content-Type with a JSON body', '', asJson],
      ['no Content-Type with a JSON body', null, asJson],
      // FR-4 (amended 2026-10-14): JSON in a charset other than UTF-8.
      [
        'JSON declared as latin1 (charset=latin1)',
        'application/json; charset=latin1',
        asJson,
      ],
      [
        'JSON declared as UTF-16 (charset=utf-16)',
        'application/json; charset=utf-16',
        asJson,
      ],
      [
        'a quoted, upper-case charset (Charset="LATIN1")',
        'application/json; Charset="LATIN1"',
        asJson,
      ],
      ['an empty charset (charset="")', 'application/json; charset=""', asJson],
    ];

    describe.each([
      { route: '/auth/login', body: loginBody, spy: () => client.loginCustom },
      {
        route: '/auth/complete-new-password',
        body: newPasswordBody,
        spy: () => client.completeNewPassword,
      },
      {
        route: '/auth/callback',
        body: callbackBody,
        spy: () => client.validateCode,
      },
    ])('POST $route', ({ route, body, spy }) => {
      it.each(refused)(
        '415 for %s: envelope, decision line, no Set-Cookie, no Cognito call',
        async (_name, contentType, encode) => {
          spy().mockRejectedValue(new InvalidCredentialsError());

          const res = await world
            .raw('post', `/api/v1${route}`, contentType, encode(body))
            .set('Cookie', PREVIOUS_SESSION_COOKIE);

          expectEnvelope(res, 415);
          expectNoSetCookie(res);
          expectNoSecrets(res);
          expect(spy()).not.toHaveBeenCalled();
          expect(decisions()).toEqual([
            {
              event: 'auth_decision',
              route: `POST /api/v1${route}`,
              outcome: 'refused',
              status: 415,
              reason: 'unsupported_media_type',
              requestId: res.headers['x-request-id'],
            },
          ]);
          const everything = logged.join('\n');
          for (const value of Object.values(body)) {
            expect(everything, 'captured log output').not.toContain(value);
          }
        },
      );
    });

    it.each([
      'application/json; charset=utf-8',
      'Application/JSON; Charset=UTF-8',
      'application/json; charset=utf8',
      'application/json; charset=UTF8',
      'application/json; charset="utf-8"',
    ])(
      'accepts %s: parameters allowed, type and UTF-8 charset compared case-insensitively',
      async (contentType) => {
        await registerCustom(world);
        client.loginCustom.mockResolvedValue({
          kind: 'tokens',
          tokens: tokensOf(ada),
        });

        const res = await world
          .raw(
            'post',
            '/api/v1/auth/login',
            contentType,
            JSON.stringify(loginBody),
          )
          .expect(200);

        expectSessionCookies(res);
        expect(client.loginCustom).toHaveBeenCalledWith(ada.email, PASSWORD);
      },
    );

    it('lets a POST with no body and no Content-Type through (the session calls of T-9)', async () => {
      const bare = await world.post('/auth/body-probe');
      const zeroLength = await world
        .post('/auth/body-probe')
        .set('Content-Length', '0');
      for (const res of [bare, zeroLength]) {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^application\/json/);
        expect(res.body.data).toEqual({ body: null });
      }
      // On a route that needs a body, it is the validation that refuses it.
      const login = await world.post('/auth/login');
      expectEnvelope(login, 400);
      expect(decisions()).toEqual([
        expect.objectContaining({ status: 400, reason: 'invalid_request' }),
      ]);
    });

    it('covers every POST under /api/v1/auth, not only the three login routes', async () => {
      const res = await world.raw(
        'post',
        '/api/v1/auth/body-probe',
        'text/plain',
        JSON.stringify({ any: 'thing' }),
      );
      expectEnvelope(res, 415);
      expect(res.body).not.toHaveProperty('body');
    });

    it.each([
      ['an upper-case path', '/API/V1/AUTH/LOGIN'],
      ['a trailing slash', '/api/v1/auth/login/'],
    ])(
      'covers %s, which the router serves as the login route',
      async (_name, url) => {
        client.loginCustom.mockRejectedValue(new InvalidCredentialsError());
        // The premise: as JSON, this path reaches the login handler.
        const json = await world.raw(
          'post',
          url,
          'application/json',
          JSON.stringify(loginBody),
        );
        expect(json.status).toBe(401);
        expect(client.loginCustom).toHaveBeenCalledTimes(1);

        const res = await world.raw(
          'post',
          url,
          'text/plain',
          JSON.stringify(loginBody),
        );
        expectEnvelope(res, 415);
        expect(client.loginCustom).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('No urlencoded or text body parsing under /api/v1/auth (FR-4)', () => {
    const fields = { email: ada.email, password: 'probe-password' };

    it.each([
      [
        'an HTML form',
        'application/x-www-form-urlencoded',
        new URLSearchParams(fields).toString(),
      ],
      ['a text/plain body that is JSON', 'text/plain', JSON.stringify(fields)],
    ])(
      'leaves %s unparsed even where the JSON-only rule does not apply (PUT)',
      async (_name, contentType, body) => {
        for (const url of [
          '/api/v1/auth/body-probe',
          '/API/V1/AUTH/BODY-PROBE',
        ]) {
          const res = await world.raw('put', url, contentType, body);
          expect(res.status, url).toBe(200);
          expect(res.body.data, url).toEqual({ body: null });
        }
      },
    );

    it('control: the probe does see a parsed body (JSON there, a form elsewhere)', async () => {
      const json = await world
        .raw(
          'put',
          '/api/v1/auth/body-probe',
          'application/json',
          JSON.stringify(fields),
        )
        .expect(200);
      expect(json.body.data).toEqual({ body: fields });

      const form = await world
        .raw(
          'put',
          '/api/v1/body-probe',
          'application/x-www-form-urlencoded',
          new URLSearchParams(fields).toString(),
        )
        .expect(200);
      expect(form.body.data).toEqual({ body: fields });
    });
  });

  describe('A failed login leaves an existing session cookie untouched (FR-9)', () => {
    const sso: Identity = {
      sub: 'sub-sso-ana',
      email: 'ana@cgiar.org',
      sso: true,
    };
    const tokensFor = (who: Identity) => ({
      kind: 'tokens',
      tokens: tokensOf(who),
    });

    const failures: Array<{
      name: string;
      route: string;
      body: object;
      status: number;
      arrange: () => Promise<unknown> | void;
    }> = [
      {
        name: 'login, wrong credentials',
        route: '/auth/login',
        body: loginBody,
        status: 401,
        arrange: () => {
          client.loginCustom.mockRejectedValue(new InvalidCredentialsError());
        },
      },
      {
        name: 'login, first-login challenge',
        route: '/auth/login',
        body: loginBody,
        status: 200,
        arrange: () => {
          client.loginCustom.mockResolvedValue({
            kind: 'challenge',
            challengeName: 'NEW_PASSWORD_REQUIRED',
            session: SESSION,
          });
        },
      },
      {
        name: 'login, not registered in QA',
        route: '/auth/login',
        body: loginBody,
        status: 403,
        arrange: () => {
          client.loginCustom.mockResolvedValue(tokensFor(ada));
        },
      },
      {
        name: 'login, the email belongs to another sub',
        route: '/auth/login',
        body: loginBody,
        status: 409,
        arrange: async () => {
          await registerCustom(world, {
            who: { ...ada, sub: 'sub-someone-else' },
          });
          client.loginCustom.mockResolvedValue(tokensFor(ada));
        },
      },
      {
        name: 'login, an id token without cognito:username',
        route: '/auth/login',
        body: loginBody,
        status: 401,
        arrange: async () => {
          await registerCustom(world);
          client.loginCustom.mockResolvedValue(
            tokensFor({ ...ada, username: null }),
          );
        },
      },
      {
        name: 'complete-new-password, completion refused',
        route: '/auth/complete-new-password',
        body: newPasswordBody,
        status: 401,
        arrange: () => {
          client.completeNewPassword.mockRejectedValue(
            new InvalidCredentialsError(),
          );
        },
      },
      {
        name: 'complete-new-password, no active assignment',
        route: '/auth/complete-new-password',
        body: newPasswordBody,
        status: 403,
        arrange: async () => {
          await registerCustom(world, { withRole: false });
          client.completeNewPassword.mockResolvedValue(tokensOf(ada));
        },
      },
      {
        name: 'callback, invalid or reused code',
        route: '/auth/callback',
        body: callbackBody,
        status: 401,
        arrange: () => {
          client.validateCode.mockRejectedValue(new InvalidCredentialsError());
        },
      },
      {
        name: 'callback, the SSO email belongs to another sub',
        route: '/auth/callback',
        body: callbackBody,
        status: 409,
        arrange: async () => {
          await registerCustom(world, {
            who: { ...sso, sub: 'sub-someone-else' },
          });
          client.validateCode.mockResolvedValue(tokensOf(sso));
        },
      },
      {
        name: 'callback, an inactive SSO user',
        route: '/auth/callback',
        body: callbackBody,
        status: 403,
        arrange: async () => {
          await registerCustom(world, { who: sso, isActive: false });
          client.validateCode.mockResolvedValue(tokensOf(sso));
        },
      },
    ];

    it.each(failures)(
      '$name: $status with a previous qa_rt/qa_ru cookie sent, and no Set-Cookie at all',
      async ({ route, body, status, arrange }) => {
        await arrange();
        const res = await world
          .post(route, body)
          .set('Cookie', PREVIOUS_SESSION_COOKIE);
        expect(res.status).toBe(status);
        expectNoSetCookie(res);
      },
    );
  });

  describe('Throttling (NFR-4)', () => {
    const throttled: Array<
      [string, () => request.Test, () => ReturnType<typeof vi.fn>]
    > = [
      [
        'POST /auth/login',
        () => world.post('/auth/login', loginBody),
        () => client.loginCustom,
      ],
      [
        'POST /auth/complete-new-password',
        () => world.post('/auth/complete-new-password', newPasswordBody),
        () => client.completeNewPassword,
      ],
      [
        'POST /auth/callback',
        () => world.post('/auth/callback', callbackBody),
        () => client.validateCode,
      ],
    ];

    it.each(throttled)(
      '%s: the 11th request in a minute answers 429 with the envelope and never reaches Cognito',
      async (_name, send, spy) => {
        spy().mockRejectedValue(new InvalidCredentialsError());

        for (let i = 1; i <= 10; i++) {
          const res = await send();
          expect(res.status, `request ${i}`).toBe(401);
        }
        const res = await send();

        expectEnvelope(res, 429, 'TOO_MANY_REQUESTS');
        expect(res.headers['retry-after']).toMatch(/^\d+$/);
        expect(res.body.error.retryAfter).toBe(
          Number(res.headers['retry-after']),
        );
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(spy()).toHaveBeenCalledTimes(10);
      },
    );

    it('counts per client IP: one more client is not limited by the first', async () => {
      client.loginCustom.mockResolvedValue({
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
      const from = (ip: string) =>
        world.post('/auth/login', loginBody).set('X-Forwarded-For', ip);

      for (let i = 0; i < 10; i++) {
        await from('203.0.113.10').expect(200);
      }
      await from('203.0.113.10').expect(429);
      await from('203.0.113.11').expect(200);
    });

    it('keys on the address the one trusted proxy appended, not on what the client claims', async () => {
      client.loginCustom.mockResolvedValue({
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
      const spoofed = (n: number) =>
        world
          .post('/auth/login', loginBody)
          .set('X-Forwarded-For', `198.51.100.${n}, 203.0.113.20`);

      for (let i = 0; i < 10; i++) {
        await spoofed(i).expect(200);
      }
      await spoofed(99).expect(429);
    });

    it('does not throttle GET /auth/provider-url', async () => {
      client.providerUrl.mockResolvedValue('https://idp.example/authorize');
      for (let i = 0; i < 12; i++) {
        await world
          .get('/auth/provider-url')
          .query({ redirectUri: REDIRECT_URI })
          .expect(200);
      }
    });
  });

  describe('Observability (NFR-7)', () => {
    it('writes one structured line per auth decision, with route, outcome, reason, user id and request id, and no secret', async () => {
      const user = await registerCustom(world);
      const tokens = tokensOf(ada);
      const sso: Identity = {
        sub: 'sub-sso',
        email: 'sso@cgiar.org',
        sso: true,
      };
      const ssoTokens = tokensOf(sso);
      const responses: request.Response[] = [];

      client.loginCustom.mockResolvedValueOnce({ kind: 'tokens', tokens });
      responses.push(await world.post('/auth/login', loginBody));

      client.loginCustom.mockResolvedValueOnce({
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
      responses.push(await world.post('/auth/login', loginBody));

      client.loginCustom.mockRejectedValueOnce(new InvalidCredentialsError());
      responses.push(await world.post('/auth/login', loginBody));

      client.loginCustom.mockRejectedValueOnce(new UpstreamUnavailableError());
      responses.push(await world.post('/auth/login', loginBody));

      client.loginCustom.mockResolvedValueOnce({
        kind: 'tokens',
        tokens: tokensOf({ ...ada, sub: 'sub-other', email: 'x@cgiar.org' }),
      });
      responses.push(await world.post('/auth/login', loginBody));

      client.loginCustom.mockResolvedValueOnce({
        kind: 'tokens',
        tokens: tokensOf({ ...ada, username: null }),
      });
      responses.push(await world.post('/auth/login', loginBody));

      responses.push(
        await world.post('/auth/login', { email: ada.email, password: '' }),
      );

      client.completeNewPassword.mockResolvedValueOnce(tokens);
      responses.push(
        await world.post('/auth/complete-new-password', newPasswordBody),
      );

      client.validateCode.mockResolvedValueOnce(ssoTokens);
      responses.push(await world.post('/auth/callback', callbackBody));

      responses.push(
        await world.post('/auth/callback', {
          code: CODE,
          redirectUri: 'https://evil.example/cb',
        }),
      );

      client.providerUrl.mockResolvedValueOnce('https://idp.example/authorize');
      responses.push(
        await world
          .get('/auth/provider-url')
          .query({ redirectUri: REDIRECT_URI }),
      );

      const lines = decisions();
      expect(lines).toHaveLength(responses.length);
      // One line per request, in order, each tied to its own response.
      lines.forEach((line, i) => {
        expect(line.event).toBe('auth_decision');
        expect(line.requestId).toBe(responses[i].headers['x-request-id']);
        expect(line.status).toBe(responses[i].status);
      });

      const summary = lines.map((l) => [l.route, l.outcome, l.reason] as const);
      expect(summary).toEqual([
        ['POST /api/v1/auth/login', 'ok', 'session_issued'],
        ['POST /api/v1/auth/login', 'challenge', 'new_password_required'],
        ['POST /api/v1/auth/login', 'refused', 'invalid_credentials'],
        ['POST /api/v1/auth/login', 'error', 'upstream_unavailable'],
        ['POST /api/v1/auth/login', 'refused', 'user_not_registered'],
        ['POST /api/v1/auth/login', 'refused', 'username_claim_missing'],
        ['POST /api/v1/auth/login', 'refused', 'invalid_request'],
        ['POST /api/v1/auth/complete-new-password', 'ok', 'session_issued'],
        ['POST /api/v1/auth/callback', 'ok', 'session_issued'],
        ['POST /api/v1/auth/callback', 'refused', 'redirect_uri_not_allowed'],
        ['GET /api/v1/auth/provider-url', 'ok', 'provider_url_issued'],
      ]);

      // The user id is there when it is known, and only then.
      expect(lines[0].userId).toBe(user.id);
      expect(lines[7].userId).toBe(user.id);
      expect(lines[8].userId).toEqual(expect.any(Number));
      expect(lines[2]).not.toHaveProperty('userId');
      expect(lines[4]).not.toHaveProperty('userId');

      // Nothing logged anywhere carries a token, a cookie, a password or a code.
      const everything = logged.join('\n');
      const secrets = [
        PASSWORD,
        NEW_PASSWORD,
        SESSION,
        CODE,
        REFRESH_TOKEN,
        USERNAME,
        tokens.accessToken,
        tokens.idToken,
        ssoTokens.accessToken,
        ssoTokens.idToken,
        'qa_rt',
        'qa_ru',
      ];
      for (const secret of secrets) {
        expect(everything).not.toContain(secret);
      }
    });

    it('logs a throttled request with its own reason', async () => {
      client.loginCustom.mockResolvedValue({
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
      });
      let last!: request.Response;
      for (let i = 0; i < 11; i++) {
        last = await world.post('/auth/login', loginBody);
      }
      expect(last.status).toBe(429);

      const lines = decisions();
      expect(lines).toHaveLength(11);
      expect(lines[10]).toMatchObject({
        route: 'POST /api/v1/auth/login',
        outcome: 'refused',
        status: 429,
        reason: 'rate_limited',
        requestId: last.headers['x-request-id'],
      });
    });
  });

  describe('Unexpected failures: a bare 500, with no data in the body or the logs (FR-9, NFR-7)', () => {
    const markers = [USERNAME, marked.email, marked.sub];

    /** The 500 envelope and nothing more: no internals, no cookie at all. */
    function expectBare500(res: request.Response) {
      expectEnvelope(res, 500);
      expect(res.body).toEqual({
        success: false,
        error: {
          status: 500,
          code: 'INTERNAL_ERROR',
          message:
            'Something went wrong on our side. Try again; if it keeps happening, contact support and share the reference code.',
        },
        meta: {
          requestId: res.headers['x-request-id'],
          timestamp: expect.any(String),
        },
      });
      expect(res.headers['set-cookie'], 'session cookie').toBeUndefined();
      expectNoSecrets(res, [
        ...markers,
        'Failed query',
        'ER_LOCK_WAIT_TIMEOUT',
      ]);
    }

    /** Nothing written anywhere, at any level, carries one of `texts`. */
    function expectNotLogged(texts: string[]) {
      const everything = logged.join('\n');
      for (const text of texts) {
        expect(everything, 'captured log output').not.toContain(text);
      }
    }

    const routes = [
      {
        route: '/auth/login',
        write: 'update' as const,
        body: { email: marked.email, password: PASSWORD },
        arrange: async () => {
          await registerCustom(world, { who: marked });
          client.loginCustom.mockResolvedValue({
            kind: 'tokens',
            tokens: tokensOf(marked),
          });
        },
      },
      {
        route: '/auth/complete-new-password',
        write: 'update' as const,
        body: {
          email: marked.email,
          newPassword: NEW_PASSWORD,
          session: SESSION,
        },
        arrange: async () => {
          await registerCustom(world, { who: marked });
          client.completeNewPassword.mockResolvedValue(tokensOf(marked));
        },
      },
      {
        route: '/auth/callback',
        write: 'insert' as const,
        body: callbackBody,
        arrange: async () => {
          client.validateCode.mockResolvedValue(
            tokensOf({ ...marked, sso: true }),
          );
        },
      },
    ];

    it.each(routes)(
      'POST $route: a DrizzleQueryError from the admission write answers a bare 500 and logs no username, email or sub',
      async ({ route, write, body, arrange }) => {
        await arrange();
        const failure = dbFailure(marked);
        // The premise: drizzle writes the params into the message, and so into the stack.
        for (const marker of markers) {
          expect(failure.message).toContain(marker);
          expect(failure.stack).toContain(marker);
        }
        const failingWrite = vi
          .spyOn(world.usersStore, write)
          .mockRejectedValue(failure);

        const res = await world.post(route, body);

        expect(failingWrite).toHaveBeenCalledTimes(1);
        expectBare500(res);
        expectNotLogged([
          ...markers,
          'Failed query',
          'params:',
          'cognito_username',
          'Lock wait timeout',
        ]);

        // The failure is still on record, by fixed fields only.
        const requestId = res.headers['x-request-id'];
        expect(unhandledLines()).toEqual([
          {
            event: 'unhandled_error',
            requestId,
            method: 'POST',
            path: `/api/v1${route}`,
            status: 500,
            responseCode: 'INTERNAL_ERROR',
            error: 'DrizzleQueryError',
            cause: 'Error',
            code: 'ER_LOCK_WAIT_TIMEOUT',
            errno: 1205,
            sqlState: 'HY000',
          },
        ]);
        expect(decisions()).toEqual([
          expect.objectContaining({
            outcome: 'error',
            status: 500,
            reason: 'internal_error',
            requestId,
          }),
        ]);
      },
    );

    it('a plain Error whose message carries the username, the email and the sub answers a bare 500 and logs none of them', async () => {
      await registerCustom(world, { who: marked });
      client.loginCustom.mockResolvedValue({
        kind: 'tokens',
        tokens: tokensOf(marked),
      });
      vi.spyOn(world.usersStore, 'update').mockRejectedValue(
        new Error(
          `connection lost while saving ${USERNAME} <${marked.email}> (${marked.sub})`,
        ),
      );

      const res = await world.post('/auth/login', {
        email: marked.email,
        password: PASSWORD,
      });

      expectBare500(res);
      expectNotLogged([...markers, 'connection lost']);
      expect(unhandledLines()).toEqual([
        {
          event: 'unhandled_error',
          requestId: res.headers['x-request-id'],
          method: 'POST',
          path: '/api/v1/auth/login',
          status: 500,
          responseCode: 'INTERNAL_ERROR',
          error: 'Error',
        },
      ]);
    });
  });
});
