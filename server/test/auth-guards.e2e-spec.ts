import { Controller, Get, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { ReadAccess } from '../src/auth/decorators/read-access.decorator.js';
import { RequirePermission } from '../src/auth/decorators/require-permission.decorator.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import type { User } from '../src/database/drizzle/schema/index.js';
import { Permission, ROLE_DEFINITIONS } from '../src/users/permissions.js';
import {
  CURRENT_USER_CLOCK,
  CurrentUserCache,
} from '../src/users/current-user.cache.js';
import {
  ROLE_ASSIGNMENTS_STORE,
  RoleAssignmentsRepository,
} from '../src/users/role-assignments.repository.js';
import { USERS_STORE, UsersRepository } from '../src/users/users.repository.js';
import {
  b64url,
  localJwksCache,
  newKeyPair,
  signJwt,
} from './support/jwt-test-keys.js';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUsersStore,
} from './support/in-memory-stores.js';

// Real Nest app (AppModule + test-only routes) with the real guards. Only the
// edges are replaced: the verifier gets a JWKS pre-loaded with a local key (no
// network) and the user/assignment stores are the in-memory fakes (no MySQL).
// The probe controllers below never check permissions themselves: they only
// record that the handler ran, so every 401/403 comes from the global guards.

const handlerSpy = vi.fn();

@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  publicRoute() {
    handlerSpy('public');
    return { route: 'public' };
  }

  @ReadAccess()
  @Get('read')
  readRoute() {
    handlerSpy('read');
    return { route: 'read' };
  }

  @RequirePermission(Permission.ADMIN_ACCESS)
  @Get('admin')
  adminRoute() {
    handlerSpy('admin');
    return { route: 'admin' };
  }

  @RequirePermission(Permission.TPB_ACCESS)
  @Post('tpb')
  tpbRoute() {
    handlerSpy('tpb');
    return { route: 'tpb' };
  }

  @RequirePermission(Permission.ASSESSOR_ACCESS)
  @Get('assessor')
  assessorRoute() {
    handlerSpy('assessor');
    return { route: 'assessor' };
  }

  // Declares neither a permission nor the read marker (FR-12, DD-5).
  @Get('undeclared')
  undeclaredRoute() {
    handlerSpy('undeclared');
    return { route: 'undeclared' };
  }
}

@Public()
@Controller('probe-public')
class PublicClassProbeController {
  @Get()
  root() {
    handlerSpy('public-class');
    return { route: 'public-class' };
  }
}

@ReadAccess()
@Controller('probe-read')
class ReadClassProbeController {
  @Get('plain')
  plain() {
    handlerSpy('read-class-plain');
    return { route: 'read-class-plain' };
  }

  // A permission declared on the handler is stricter than the class marker.
  @RequirePermission(Permission.ADMIN_ACCESS)
  @Get('admin')
  admin() {
    handlerSpy('read-class-admin');
    return { route: 'read-class-admin' };
  }
}

@Module({
  controllers: [
    ProbeController,
    PublicClassProbeController,
    ReadClassProbeController,
  ],
})
class ProbeModule {}

const REGION = process.env.COGNITO_REGION!;
const POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const KID = 'e2e-kid';

const signer = newKeyPair(KID);
const stranger = newKeyPair(KID); // same kid, different key material

const nowSeconds = () => Math.floor(Date.now() / 1000);

function accessClaims(sub: string, overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function idClaims(sub: string) {
  return {
    sub,
    iss: ISSUER,
    aud: CLIENT_ID,
    token_use: 'id',
    'cognito:username': sub,
    email: `${sub}@cgiar.org`,
    auth_time: nowSeconds(),
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
  };
}

const accessToken = (sub: string, overrides: Record<string, unknown> = {}) =>
  signJwt(accessClaims(sub, overrides), signer);

type Method = 'get' | 'post';

interface World {
  app: NestExpressApplication;
  usersStore: InMemoryUsersStore;
  assignmentsStore: InMemoryRoleAssignmentsStore;
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
  /** Resolved lazily: the cache is part of the code under test. */
  currentUserCache: () => CurrentUserCache;
  advance(ms: number): void;
  call(method: Method, path: string, authorization?: string): request.Test;
  bearer(sub: string): string;
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

  // The cache's only time source: tests move it, no real timer is involved.
  const clock = { now: 1_700_000_000_000 };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ProbeModule],
  })
    .overrideProvider(USERS_STORE)
    .useValue(usersStore)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(assignmentsStore)
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    .overrideProvider(CURRENT_USER_CLOCK)
    .useValue(() => clock.now)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    usersStore,
    assignmentsStore,
    users: new UsersRepository(usersStore),
    assignments: new RoleAssignmentsRepository(assignmentsStore),
    currentUserCache: () => moduleRef.get(CurrentUserCache, { strict: false }),
    advance: (ms) => {
      clock.now += ms;
    },
    call: (method, path, authorization) => {
      const req = request(app.getHttpServer())[method](`/api/v1${path}`);
      return authorization === undefined
        ? req
        : req.set('Authorization', authorization);
    },
    bearer: (sub) => `Bearer ${accessToken(sub)}`,
    close: () => app.close(),
  };
}

let seq = 0;

/** Registers a user as the admission step would have left it. */
async function addUser(
  world: World,
  options: { authSource?: 'sso' | 'custom'; isActive?: boolean } = {},
): Promise<User> {
  const n = ++seq;
  const user = await world.users.create({
    email: `user${n}@cgiar.org`,
    cognitoSub: `sub-${n}`,
    firstName: 'Ada',
    lastName: `Lovelace ${n}`,
    authSource: options.authSource ?? 'sso',
  });
  // The in-memory store hands out its own row, so this changes the stored user.
  if (options.isActive === false) user.isActive = false;
  return user;
}

const sub = (user: User) => user.cognitoSub!;

describe('Global guards (e2e)', () => {
  let world: World;

  beforeEach(async () => {
    handlerSpy.mockClear();
    world = await buildWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  describe('AuthGuard: public routes (FR-10)', () => {
    it('serves a @Public() route without a token', async () => {
      const res = await world.call('get', '/probe/public').expect(200);
      expect(res.body.data).toEqual({ route: 'public' });
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });

    it('serves a @Public() route even when the token is garbage', async () => {
      await world.call('get', '/probe/public', 'Bearer not-a-jwt').expect(200);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });

    it('honours @Public() declared on the controller class', async () => {
      await world.call('get', '/probe-public').expect(200);
      expect(handlerSpy).toHaveBeenCalledWith('public-class');
    });
  });

  describe('AuthGuard: token required on every other route (FR-10)', () => {
    const guardedRoutes: Array<[Method, string]> = [
      ['get', '/probe/read'],
      ['get', '/probe/admin'],
      ['post', '/probe/tpb'],
      ['get', '/probe/assessor'],
      ['get', '/probe/undeclared'],
      ['get', '/probe-read/plain'],
      ['get', '/probe-read/admin'],
      ['get', '/auth/me'],
    ];

    it.each(guardedRoutes)(
      '%s %s without a token answers 401 and the handler does not run',
      async (method, path) => {
        const res = await world.call(method, path).expect(401);
        expect(res.body).toEqual({
          success: false,
          error: {
            status: 401,
            code: 'AUTH_TOKEN_INVALID',
            message: 'Your session is not valid or has expired. Sign in again.',
          },
          meta: {
            requestId: expect.any(String),
            timestamp: expect.any(String),
          },
        });
        expect(handlerSpy).not.toHaveBeenCalled();
      },
    );

    describe('rejected credentials', () => {
      let admitted: User;

      beforeEach(async () => {
        admitted = await addUser(world);
      });

      it('accepts the control case: a valid token of an admitted user', async () => {
        await world
          .call('get', '/probe/read', world.bearer(sub(admitted)))
          .expect(200);
        expect(handlerSpy).toHaveBeenCalledTimes(1);
      });

      it('accepts the Bearer scheme in any letter case (RFC 9110)', async () => {
        await world
          .call('get', '/probe/read', `bearer ${accessToken(sub(admitted))}`)
          .expect(200);
      });

      const rejections: Array<[string, (sub: string) => string]> = [
        ['an empty Bearer value', () => 'Bearer'],
        ['a non-Bearer scheme', (s) => `Basic ${accessToken(s)}`],
        ['a token with no scheme', (s) => accessToken(s)],
        ['two tokens', (s) => `Bearer ${accessToken(s)} ${accessToken(s)}`],
        ['a value that is not a JWT', () => 'Bearer not-a-jwt'],
        [
          'an expired token',
          (s) => `Bearer ${accessToken(s, { exp: nowSeconds() - 3600 })}`,
        ],
        [
          'a token signed by another key',
          (s) => `Bearer ${signJwt(accessClaims(s), stranger)}`,
        ],
        ['an id token', (s) => `Bearer ${signJwt(idClaims(s), signer)}`],
        [
          'a token of another issuer (another pool)',
          (s) =>
            `Bearer ${accessToken(s, { iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other' })}`,
        ],
        [
          'a token whose kid is not in the key set',
          (s) => `Bearer ${signJwt(accessClaims(s), signer, 'unknown-kid')}`,
        ],
        [
          'a token of another app client',
          (s) => `Bearer ${accessToken(s, { client_id: 'some-other-client' })}`,
        ],
        [
          'an unsigned token (alg none)',
          (s) =>
            `Bearer ${b64url({ alg: 'none', typ: 'JWT', kid: KID })}.${b64url(accessClaims(s))}.`,
        ],
      ];

      it.each(rejections)(
        'answers 401 for %s and the handler does not run',
        async (_name, authorization) => {
          await world
            .call('get', '/probe/read', authorization(sub(admitted)))
            .expect(401);
          expect(handlerSpy).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('AuthGuard: who is admitted (FR-11)', () => {
    it('refuses a valid token whose sub has no QA user', async () => {
      await world
        .call('get', '/probe/read', world.bearer('sub-nobody'))
        .expect(401);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('refuses an inactive user', async () => {
      const user = await addUser(world, { isActive: false });
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(401);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('refuses a custom user without active assignments', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(401);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('refuses a custom user whose only assignment was revoked', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      const assignment = await world.assignments.create({
        userId: user.id,
        roleCode: 'ADMIN',
      });
      await world.assignments.revoke(assignment.id, user.id);
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(401);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('refuses a custom user whose only assignment is of an inactive role', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      await world.assignments.create({ userId: user.id, roleCode: 'TPB' });
      world.assignmentsStore.roles.find((r) => r.code === 'TPB')!.isActive =
        false;
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(401);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('admits a custom user with an active assignment', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      await world.assignments.create({ userId: user.id, roleCode: 'TPB' });
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(200);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });

    it('admits an SSO user with no assignments as GUEST', async () => {
      const user = await addUser(world, { authSource: 'sso' });
      await world
        .call('get', '/probe/read', world.bearer(sub(user)))
        .expect(200);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('PermissionGuard (FR-12)', () => {
    it('lets GUEST read and refuses every action route with 403', async () => {
      const guest = await addUser(world);
      const token = world.bearer(sub(guest));

      await world.call('get', '/probe/read', token).expect(200);
      await world.call('get', '/probe-read/plain', token).expect(200);
      handlerSpy.mockClear();

      for (const [method, path] of [
        ['get', '/probe/admin'],
        ['post', '/probe/tpb'],
        ['get', '/probe/assessor'],
        ['get', '/probe-read/admin'],
      ] as Array<[Method, string]>) {
        const res = await world.call(method, path, token).expect(403);
        expect(res.body).toEqual({
          success: false,
          error: {
            status: 403,
            code: 'AUTH_PERMISSION_DENIED',
            message: 'You do not have permission to do this.',
          },
          meta: {
            requestId: expect.any(String),
            timestamp: expect.any(String),
          },
        });
      }
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('denies a route that declares neither a permission nor the read marker', async () => {
      const guest = await addUser(world);
      await world
        .call('get', '/probe/undeclared', world.bearer(sub(guest)))
        .expect(403);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('denies an undeclared route even to an ADMIN (no bypass)', async () => {
      const admin = await addUser(world);
      await world.assignments.create({ userId: admin.id, roleCode: 'ADMIN' });
      await world
        .call('get', '/probe/undeclared', world.bearer(sub(admin)))
        .expect(403);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('lets the holder of the declared permission through', async () => {
      const admin = await addUser(world);
      await world.assignments.create({ userId: admin.id, roleCode: 'ADMIN' });
      const res = await world
        .call('get', '/probe/admin', world.bearer(sub(admin)))
        .expect(200);
      expect(res.body.data).toEqual({ route: 'admin' });
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });

    // FR-14: ADMIN holds every permission, so the refused role here is PPU.
    it('refuses a role that does not hold the declared permission', async () => {
      const ppu = await addUser(world);
      await world.assignments.create({ userId: ppu.id, roleCode: 'PPU' });
      await world
        .call('post', '/probe/tpb', world.bearer(sub(ppu)))
        .expect(403);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('lets ADMIN through a route that declares another role permission (FR-14)', async () => {
      const admin = await addUser(world);
      await world.assignments.create({ userId: admin.id, roleCode: 'ADMIN' });
      await world
        .call('post', '/probe/tpb', world.bearer(sub(admin)))
        .expect(201);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });

    it('passes a scoped permission at route level whatever the scope (DD-4)', async () => {
      const assessor = await addUser(world);
      await world.assignments.create({
        userId: assessor.id,
        roleCode: 'ASSESSOR',
        resultTypeKey: 'KP',
      });
      await world
        .call('get', '/probe/assessor', world.bearer(sub(assessor)))
        .expect(200);
    });

    it('lets a handler permission tighten a class-level read marker', async () => {
      const guest = await addUser(world);
      const admin = await addUser(world);
      await world.assignments.create({ userId: admin.id, roleCode: 'ADMIN' });

      await world
        .call('get', '/probe-read/admin', world.bearer(sub(guest)))
        .expect(403);
      await world
        .call('get', '/probe-read/admin', world.bearer(sub(admin)))
        .expect(200);
      expect(handlerSpy).toHaveBeenCalledTimes(1);
      expect(handlerSpy).toHaveBeenCalledWith('read-class-admin');
    });
  });

  describe('current user freshness (FR-11, DD-6)', () => {
    it('keeps the loaded state inside 60 s and reloads after it', async () => {
      const user = await addUser(world);
      const assignment = await world.assignments.create({
        userId: user.id,
        roleCode: 'ADMIN',
      });
      const token = world.bearer(sub(user));
      await world.call('get', '/probe/admin', token).expect(200);

      await world.assignments.revoke(assignment.id, user.id);

      world.advance(59_000);
      await world.call('get', '/probe/admin', token).expect(200); // still cached

      world.advance(2_000); // 61 s after the load
      await world.call('get', '/probe/admin', token).expect(403); // now GUEST
    });

    it('stops admitting a custom user whose last assignment was revoked, after 60 s', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      const assignment = await world.assignments.create({
        userId: user.id,
        roleCode: 'TPB',
      });
      const token = world.bearer(sub(user));
      await world.call('get', '/probe/read', token).expect(200);

      await world.assignments.revoke(assignment.id, user.id);
      world.advance(61_000);
      await world.call('get', '/probe/read', token).expect(401);
    });

    it('stops admitting a user deactivated in the meantime, after 60 s', async () => {
      const user = await addUser(world);
      const token = world.bearer(sub(user));
      await world.call('get', '/probe/read', token).expect(200);

      user.isActive = false;
      world.advance(61_000);
      await world.call('get', '/probe/read', token).expect(401);
    });

    it('picks up a new grant after 60 s', async () => {
      const user = await addUser(world);
      const token = world.bearer(sub(user));
      await world.call('get', '/probe/admin', token).expect(403);

      await world.assignments.create({ userId: user.id, roleCode: 'ADMIN' });
      world.advance(61_000);
      await world.call('get', '/probe/admin', token).expect(200);
    });

    it('reflects a change at once when the process invalidates the user', async () => {
      const user = await addUser(world);
      const assignment = await world.assignments.create({
        userId: user.id,
        roleCode: 'ADMIN',
      });
      const token = world.bearer(sub(user));
      await world.call('get', '/probe/admin', token).expect(200);

      await world.assignments.revoke(assignment.id, user.id);
      world.currentUserCache().invalidate(user.id);

      await world.call('get', '/probe/admin', token).expect(403); // no clock move
    });
  });

  describe('GET /auth/me (FR-15)', () => {
    it('returns the profile of a GUEST with no assignments', async () => {
      const guest = await addUser(world);
      const res = await world
        .call('get', '/auth/me', world.bearer(sub(guest)))
        .expect(200);
      expect(res.body.data).toEqual({
        id: guest.id,
        email: guest.email,
        firstName: 'Ada',
        lastName: guest.lastName,
        authSource: 'sso',
        assignments: [],
      });
    });

    it('returns the active assignments with their scope', async () => {
      const user = await addUser(world, { authSource: 'custom' });
      await world.assignments.create({ userId: user.id, roleCode: 'ADMIN' });
      await world.assignments.create({
        userId: user.id,
        roleCode: 'LEAD_ASSESSOR',
        resultTypeKey: 'KP',
      });
      await world.assignments.create({
        userId: user.id,
        roleCode: 'PROGRAM',
        programId: 12,
      });
      const revoked = await world.assignments.create({
        userId: user.id,
        roleCode: 'TPB',
      });
      await world.assignments.revoke(revoked.id, user.id);

      const res = await world
        .call('get', '/auth/me', world.bearer(sub(user)))
        .expect(200);

      expect(res.body.data.authSource).toBe('custom');
      expect(res.body.data.assignments).toHaveLength(3);
      expect(res.body.data.assignments).toEqual(
        expect.arrayContaining([
          { role: 'ADMIN' },
          { role: 'LEAD_ASSESSOR', resultTypeKey: 'KP' },
          { role: 'PROGRAM', programId: 12 },
        ]),
      );
    });

    it('exposes nothing beyond the profile shape', async () => {
      const user = await addUser(world);
      const res = await world
        .call('get', '/auth/me', world.bearer(sub(user)))
        .expect(200);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'assignments',
        'authSource',
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
    });
  });
});
