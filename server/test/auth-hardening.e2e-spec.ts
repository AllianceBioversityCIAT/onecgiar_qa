import { Controller, Get, Logger, Module, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { COGNITO_TIMEOUT_MS } from '../src/auth/cognito-auth.client.js';
import {
  IS_PUBLIC_KEY,
  Public,
} from '../src/auth/decorators/public.decorator.js';
import { AuthGuard } from '../src/auth/guards/auth.guard.js';
import { PermissionGuard } from '../src/auth/guards/permission.guard.js';
import { MeController } from '../src/auth/me.controller.js';
import {
  JWKS_CACHE,
  TokenVerifier,
} from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import type { User } from '../src/database/drizzle/schema/index.js';
import { AuthorizationService } from '../src/users/authorization.service.js';
import {
  CURRENT_USER_CLOCK,
  CurrentUserCache,
} from '../src/users/current-user.cache.js';
import { ROLE_DEFINITIONS } from '../src/users/permissions.js';
import {
  ROLE_ASSIGNMENTS_STORE,
  RoleAssignmentsRepository,
} from '../src/users/role-assignments.repository.js';
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

// Hardening checks of the auth spec (T-10): the route inventory (FR-10, the
// "route reachable without a token" defect class), the guard latency budget
// (NFR-5) and Cognito-down behavior (NFR-6). All of it runs on the
// real app and the real guards; only the edges are replaced (a local key set,
// in-memory stores, and for NFR-6 the global `fetch` the client calls).

const REGION = process.env.COGNITO_REGION!;
const POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const KID = 'hardening-e2e-kid';
const signer = newKeyPair(KID);

const nowSeconds = () => Math.floor(Date.now() / 1000);

const bearerOf = (sub: string) =>
  `Bearer ${signJwt(
    {
      sub,
      iss: ISSUER,
      client_id: CLIENT_ID,
      token_use: 'access',
      scope: 'aws.cognito.signin.user.admin',
      username: sub,
      auth_time: nowSeconds(),
      iat: nowSeconds(),
      exp: nowSeconds() + 3600,
      jti: `jti-${sub}`,
    },
    signer,
  )}`;

// --- Test-only routes ------------------------------------------------------------

/** A route marked `@Public()` by mistake: the control of the inventory. */
@Controller('rogue')
class RogueController {
  @Public()
  @Get('leak')
  leak() {
    return { leaked: true };
  }
}

@Module({ controllers: [RogueController] })
class RogueModule {}

// --- World ----------------------------------------------------------------------

interface World {
  app: NestExpressApplication;
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
  call(method: string, path: string, authorization?: string): request.Test;
  addUser(sub: string): Promise<User>;
  close(): Promise<void>;
}

async function buildWorld(extraModules: unknown[] = []): Promise<World> {
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

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(extraModules as never[])],
  })
    .overrideProvider(USERS_STORE)
    .useValue(usersStore)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(assignmentsStore)
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    // The cache's only time source: it never expires inside a test.
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
    call: (method, path, authorization) => {
      const req = (
        request(app.getHttpServer()) as unknown as Record<
          string,
          (url: string) => request.Test
        >
      )[method.toLowerCase()](path);
      return authorization === undefined
        ? req
        : req.set('Authorization', authorization);
    },
    addUser: (sub) =>
      users.create({
        email: `${sub}@cgiar.org`,
        cognitoSub: sub,
        firstName: 'Ada',
        lastName: 'Lovelace',
        authSource: 'sso',
      }),
    close: () => app.close(),
  };
}

/** Silences the app's own log output (a 503 is logged as an error). */
function silenceLogs() {
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
}

// --- Route inventory (FR-10) ---------------------------------------------------

/** FR-10, "Public routes": the only routes that may be served without a token. */
const FR10_PUBLIC_ROUTES: readonly string[] = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/complete-new-password',
  'GET /api/v1/auth/provider-url',
  'POST /api/v1/auth/callback',
  'POST /api/v1/auth/session/refresh',
  'POST /api/v1/auth/session/logout',
  'GET /api/v1/health',
];

/** What the Express router serves: one `METHOD /path` per route and method. */
function servedRoutes(app: NestExpressApplication): string[] {
  const { router } = app.getHttpAdapter().getInstance() as {
    router: {
      stack: Array<{ route?: { path: string; methods: Record<string, true> } }>;
    };
  };
  return router.stack.flatMap(({ route }) =>
    route === undefined
      ? []
      : Object.keys(route.methods).map(
          (method) =>
            `${method === '_all' ? 'ALL' : method.toUpperCase()} ${route.path}`,
        ),
  );
}

const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`;

/**
 * What the controllers declare: `METHOD /path` of every handler (prefix,
 * controller path and handler path, as the router composes them) and whether
 * `@Public()` covers it, read the way the guards read it (handler, then class).
 */
function declaredRoutes(app: NestExpressApplication): Map<string, boolean> {
  const reflector = app.get(Reflector, { strict: false });
  const routes = new Map<string, boolean>();
  for (const module of app.get(ModulesContainer, { strict: false }).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== 'function') continue;
      const controllerPath = Reflect.getMetadata(
        PATH_METADATA,
        metatype,
      ) as string;
      for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
        const handler = (metatype.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const handlerPath = Reflect.getMetadata(
          PATH_METADATA,
          handler,
        ) as string;
        routes.set(
          `${RequestMethod[method]} ${joinPath('api/v1', controllerPath, handlerPath)}`,
          reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
            handler,
            metatype,
          ]) === true,
        );
      }
    }
  }
  return routes;
}

interface Inventory {
  served: string[];
  declared: Map<string, boolean>;
  /** Served routes covered by `@Public()`. */
  publicRoutes: string[];
  /** Served routes that are not. */
  guardedRoutes: string[];
}

function inventoryOf(app: NestExpressApplication): Inventory {
  const served = servedRoutes(app).sort();
  const declared = declaredRoutes(app);
  return {
    served,
    declared,
    publicRoutes: served.filter((key) => declared.get(key) === true),
    guardedRoutes: served.filter((key) => declared.get(key) === false),
  };
}

describe('Route inventory (FR-10, e2e)', () => {
  let world: World;

  beforeEach(async () => {
    silenceLogs();
    world = await buildWorld();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  it('reads a live router: it finds the routes the app is known to serve', () => {
    const { served } = inventoryOf(world.app);
    expect(served).toEqual(
      expect.arrayContaining([
        'GET /api/v1/health',
        'GET /api/v1/auth/me',
        'POST /api/v1/auth/login',
      ]),
    );
  });

  it('classifies every served route: the router and the controllers agree', () => {
    const { served, declared } = inventoryOf(world.app);
    expect(served).toEqual([...declared.keys()].sort());
  });

  it('serves without a token exactly FR-10 list', () => {
    expect(inventoryOf(world.app).publicRoutes).toEqual(
      [...FR10_PUBLIC_ROUTES].sort(),
    );
  });

  it('answers 401 without a token on every other route', async () => {
    const { guardedRoutes } = inventoryOf(world.app);
    // The sweep must cover something, or a classification bug would pass it.
    expect(guardedRoutes).toEqual(
      expect.arrayContaining(['GET /api/v1/auth/me']),
    );

    const refused: Array<[string, number]> = [];
    for (const key of guardedRoutes) {
      const [method, path] = key.split(' ');
      const res = await world.call(
        method === 'ALL' ? 'get' : method,
        path.replace(/:[^/]+/g, '1'),
      );
      if (res.status !== 401) refused.push([key, res.status]);
      else {
        expect(res.body, key).toMatchObject({
          success: false,
          error: { status: 401, code: 'AUTH_TOKEN_INVALID' },
          meta: { requestId: expect.any(String) },
        });
      }
    }
    expect(refused, 'routes that did not answer 401 without a token').toEqual(
      [],
    );
  });

  describe('control: the inventory catches a mistake', () => {
    it('lists a route marked @Public() by accident, and the equality refuses it', async () => {
      const mistaken = await buildWorld([RogueModule]);
      try {
        const { publicRoutes } = inventoryOf(mistaken.app);
        expect(publicRoutes).toContain('GET /api/v1/rogue/leak');
        expect(publicRoutes).not.toEqual([...FR10_PUBLIC_ROUTES].sort());
        // And the route really is reachable without a token.
        await mistaken.call('get', '/api/v1/rogue/leak').expect(200);
      } finally {
        await mistaken.close();
      }
    });
  });
});

// --- NFR-5: guard latency --------------------------------------------------------

const SAMPLES = 500;
const WARM_UP = 50;
const P95_BUDGET_MS = 20;

/** Nearest-rank percentile of an ascending list. */
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

describe('NFR-5: what the guards add to an authenticated request (e2e)', () => {
  let world: World;

  beforeEach(async () => {
    silenceLogs();
    world = await buildWorld();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  // Measured on the guards themselves (the real `AuthGuard` and
  // `PermissionGuard`, the real verifier over the local key set, the real
  // current-user cache), not as the difference of two HTTP latencies: the
  // difference of two noisy distributions says nothing about a budget that is
  // a hundred times smaller than their noise. The JWKS and the cache are warm.
  it(`p95 of guard + user load stays within ${P95_BUDGET_MS} ms over ${SAMPLES} requests`, async () => {
    const user = await world.addUser('sub-latency');
    await world.assignments.create({ userId: user.id, roleCode: 'ADMIN' });

    const reflector = world.app.get(Reflector, { strict: false });
    const authGuard = new AuthGuard(
      reflector,
      world.app.get(TokenVerifier, { strict: false }),
      world.app.get(CurrentUserCache, { strict: false }),
    );
    const permissionGuard = new PermissionGuard(
      reflector,
      world.app.get(AuthorizationService, { strict: false }),
    );
    const authorization = bearerOf('sub-latency');
    const handler = Object.getOwnPropertyDescriptor(
      MeController.prototype,
      'me',
    )!.value as () => unknown;

    const run = async () => {
      const req: { headers: Record<string, string>; user?: unknown } = {
        headers: { authorization },
      };
      const context = {
        getHandler: () => handler,
        getClass: () => MeController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as never;
      const started = performance.now();
      await authGuard.canActivate(context);
      permissionGuard.canActivate(context);
      const elapsed = performance.now() - started;
      expect(req.user, 'the guards authenticated the request').toBeDefined();
      return elapsed;
    };

    for (let i = 0; i < WARM_UP; i++) await run(); // warm JWKS, cache, JIT
    const timings: number[] = [];
    for (let i = 0; i < SAMPLES; i++) timings.push(await run());

    const sorted = [...timings].sort((a, b) => a - b);
    const spread = {
      n: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1],
    };
    if (process.env.NFR5_REPORT) {
      console.info(
        `NFR-5 guard latency (ms) n=${spread.n} p50=${spread.p50.toFixed(3)} p95=${spread.p95.toFixed(3)} max=${spread.max.toFixed(3)}`,
      );
    }
    expect(spread.n).toBeGreaterThanOrEqual(200);
    expect(
      spread.p95,
      `p95 ${spread.p95.toFixed(3)} ms (p50 ${spread.p50.toFixed(3)}, max ${spread.max.toFixed(3)})`,
    ).toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});

// --- NFR-6: Cognito is down -------------------------------------------

/**
 * The 10 s deadline of the client, taken by the test instead of waited for:
 * the timer the client arms with exactly that delay is held back, and firing
 * it is the moment the 10 s elapse. Every other timer runs as usual.
 */
function holdAuthDeadlines() {
  const held: Array<{ ms: number; fire: () => void }> = [];
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === 10_000) {
      held.push({ ms, fire: () => callback(...args) });
      return 0;
    }
    return realSetTimeout(callback, ms, ...args);
  }) as never);
  return held;
}

/** A Cognito endpoint that never answers until the request is aborted. */
const hangUntilAborted = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('This operation was aborted', 'AbortError')),
    );
  });

describe('NFR-6: Cognito is down (e2e)', () => {
  let world: World;
  let held: ReturnType<typeof holdAuthDeadlines> = [];
  const login = { email: 'ada@cgiar.org', password: 'P@ssw0rd-nfr6-SECRET' };

  beforeEach(async () => {
    silenceLogs();
    world = await buildWorld();
    await world.addUser('sub-nfr6');
  });

  afterEach(async () => {
    // A request still waiting on its deadline would hold the app open.
    for (const deadline of held) deadline.fire();
    held = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await world.close();
  });

  const expectUnavailable = (res: request.Response) => {
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: { status: 503, code: 'AUTH_SERVICE_UNAVAILABLE' },
      meta: { requestId: expect.any(String) },
    });
    expect(res.headers['set-cookie'], 'Set-Cookie header').toBeUndefined();
    expect(res.text).not.toContain(login.password);
  };

  /** Users with a valid token keep being served, whatever Cognito does. */
  const expectOtherRoutesServed = async () => {
    const me = await world
      .call('get', '/api/v1/auth/me', bearerOf('sub-nfr6'))
      .expect(200);
    expect(me.body.data).toMatchObject({ email: 'sub-nfr6@cgiar.org' });
    await world.call('get', '/api/v1/health').expect(200);
  };

  it('answers 503 with the envelope once the 10 s deadline passes, while other routes keep being served', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
    held = holdAuthDeadlines();

    const pending = world.call('post', '/api/v1/auth/login').send(login);
    pending.then(
      () => undefined,
      () => undefined,
    );
    await vi.waitFor(
      () => expect(held, 'the client arms a 10 s deadline').toHaveLength(1),
      { timeout: 2000 },
    );
    expect(held[0].ms).toBe(10_000);
    expect(COGNITO_TIMEOUT_MS).toBe(10_000);

    // The login is hanging: nobody else is affected.
    await expectOtherRoutesServed();

    held[0].fire(); // 10 s elapse
    expectUnavailable(await pending);
    await expectOtherRoutesServed();
  });

  it.each([
    [
      'a 5xx answer',
      () =>
        vi.fn(
          async () => new Response('upstream-detail-SECRET', { status: 502 }),
        ),
    ],
    [
      'a network failure',
      () =>
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
    ],
  ])('answers 503 with the envelope on %s', async (_name, stub) => {
    vi.stubGlobal('fetch', stub());

    const res = await world.call('post', '/api/v1/auth/login').send(login);

    expectUnavailable(res);
    expect(res.text).not.toContain('upstream-detail-SECRET');
    await expectOtherRoutesServed();
  });
});
