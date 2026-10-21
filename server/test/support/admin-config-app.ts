import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADMIN_CONFIG_CLOCK } from '../../src/admin-config/admin-config.clock.js';
import { CYCLES_STORE } from '../../src/admin-config/cycles/cycles.store.js';
import { CYCLES_UNIT_OF_WORK } from '../../src/admin-config/cycles/cycles.unit-of-work.js';
import { TIMELINE_LOADS } from '../../src/admin-config/timelines/timeline-loads.js';
import { TIMELINES_STORE } from '../../src/admin-config/timelines/timelines.store.js';
import { TIMELINES_UNIT_OF_WORK } from '../../src/admin-config/timelines/timelines.unit-of-work.js';
import { AppModule } from '../../src/app.module.js';
import { JWKS_CACHE } from '../../src/auth/token-verifier.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../src/common/idempotency/idempotency.store.js';
import { UpstreamUnavailableError } from '../../src/users/catalogs/catalogs.errors.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../../src/users/user-programs.repository.js';
import { USERS_STORE } from '../../src/users/users.repository.js';
import {
  InMemoryAdminConfigDatabase,
  InMemoryCyclesUnitOfWork,
  InMemoryTimelinesUnitOfWork,
} from './in-memory-admin-config.js';
import { FakeClock } from './in-memory-idempotency.js';
import { localJwksCache, newKeyPair, signJwt } from './jwt-test-keys.js';
import { adminWorld, PROGRAMS, RESULT_TYPES } from './users-admin-world.js';

// The real app over the in-memory admin-config world (pattern of
// `users-admin-app.ts`): guards, pipe, filter, interceptors and OpenAPI are
// real; the users and cycles stores, the key store and the clocks are fakes.
// Users and cycles share one `InMemoryDatabase`, so the transactions of both
// use the same row locks and the same idempotency rows.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('admin-config-app-kid');
const now = () => Math.floor(Date.now() / 1000);

export const bearer = (sub: string) =>
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

export type AdminConfigApp = Awaited<ReturnType<typeof buildAdminConfigApp>>;

export async function buildAdminConfigApp() {
  const w = adminWorld();
  const world = new InMemoryAdminConfigDatabase(w.db);
  const unitOfWork = new InMemoryCyclesUnitOfWork(world);
  const timelinesUnitOfWork = new InMemoryTimelinesUnitOfWork(world);
  // The two catalogs a timeline's scope is checked against. A test flips a
  // switch BEFORE the first request (the catalog service keeps a copy of what
  // it read) to make a source fail the way an unreachable one does.
  const catalogs = { programsDown: false, resultTypesDown: false };
  // The cycles services read the time only through this clock (NFR-4).
  const adminClock = new FakeClock(new Date('2026-10-20T10:00:00.000Z'));

  const actor = async (sub: string, roles: Array<[string, string?]>) => {
    const user = await w.users.create({
      email: `${sub}@cgiar.org`,
      cognitoSub: sub,
      firstName: sub,
      lastName: 'Actor',
      authSource: 'sso',
      nickname: null,
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
  const admin = await actor('sub-admin', [['ADMIN']]);
  const admin2 = await actor('sub-admin2', [['ADMIN']]);
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
    .overrideProvider(CYCLES_STORE)
    .useValue(world.store)
    .overrideProvider(CYCLES_UNIT_OF_WORK)
    .useValue(unitOfWork)
    .overrideProvider(TIMELINES_STORE)
    .useValue(world.timelineStore)
    .overrideProvider(TIMELINES_UNIT_OF_WORK)
    .useValue(timelinesUnitOfWork)
    // The fake loads port: a real statement in the read log, settable per timeline (DD-8).
    .overrideProvider(TIMELINE_LOADS)
    .useValue(world.loads)
    .overrideProvider(SCIENCE_PROGRAM_SOURCE)
    .useValue({
      list: async () => {
        if (catalogs.programsDown) throw new UpstreamUnavailableError();
        return PROGRAMS;
      },
    })
    .overrideProvider(RESULT_TYPE_SOURCE)
    .useValue({
      list: async () => {
        if (catalogs.resultTypesDown) throw new UpstreamUnavailableError();
        return RESULT_TYPES;
      },
    })
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(w.idempotency)
    .overrideProvider(IDEMPOTENCY_CLOCK)
    .useValue(w.clock.now)
    .overrideProvider(ADMIN_CONFIG_CLOCK)
    .useValue(adminClock.now)
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  /** One request; `key` adds an `Idempotency-Key`, `token: null` sends no credentials. */
  const send = (
    method: 'get' | 'post' | 'delete',
    path: string,
    options: { token?: string | null; key?: string; body?: object } = {},
  ) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    const token =
      options.token === undefined ? bearer('sub-admin') : options.token;
    if (token !== null) call.set('Authorization', token);
    if (options.key !== undefined) call.set('Idempotency-Key', options.key);
    return options.body === undefined ? call : call.send(options.body);
  };

  return {
    ...w,
    world,
    unitOfWork,
    timelinesUnitOfWork,
    catalogs,
    adminClock,
    app,
    admin,
    admin2,
    send,
    adminToken: bearer('sub-admin'),
  };
}
