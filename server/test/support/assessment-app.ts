// @akili-spec assessment/step-1-assessment
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADMIN_CONFIG_CLOCK } from '../../src/admin-config/admin-config.clock.js';
import { TIMELINE_LOADS } from '../../src/admin-config/timelines/timeline-loads.js';
import { AppModule } from '../../src/app.module.js';
import { WORKLIST_STORE } from '../../src/assessment/worklist.store.js';
import { JWKS_CACHE } from '../../src/auth/token-verifier.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../../src/users/user-programs.repository.js';
import { USERS_STORE } from '../../src/users/users.repository.js';
import {
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
} from './in-memory-assessment.js';
import { localJwksCache, newKeyPair, signJwt } from './jwt-test-keys.js';
import { adminWorld, PROGRAMS, RESULT_TYPES } from './users-admin-world.js';

// The real app over the in-memory assessment world (pattern of
// `users-admin-app.ts`): guards, pipe, filter, interceptors and OpenAPI are
// real; the users stores, the worklist store, the loads probe, the catalog
// sources and the clock are fakes. The routes are called over HTTP only.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('assessment-app-kid');
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

export type AssessmentApp = Awaited<ReturnType<typeof buildAssessmentApp>>;

/** `at` is the clock of the services (inside step 1 by default). */
export async function buildAssessmentApp(
  at: Date = new Date('2026-03-15T10:00:00.000Z'),
) {
  const w = adminWorld();
  const world = new InMemoryAssessmentWorld();
  const actor = async (
    sub: string,
    roles: Array<[string, string?]>,
    nickname: string | null = null,
  ) => {
    const user = await w.users.create({
      email: `${sub}@cgiar.org`,
      cognitoSub: sub,
      firstName: sub,
      lastName: 'Actor',
      authSource: 'sso',
      nickname,
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
  const users = {
    admin: await actor('sub-admin', [['ADMIN']], 'Ada'),
    assessor: await actor('sub-assessor', [['ASSESSOR', 'KP']], 'Ana'),
    // Granted like the assessor, but assigned to no timeline.
    other: await actor('sub-other', [['ASSESSOR', 'KP']], 'Otto'),
    guest: await actor('sub-guest', []),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USERS_STORE)
    .useValue(w.db.stores.users)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(w.db.stores.assignments)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(w.db.stores.programs)
    .overrideProvider(WORKLIST_STORE)
    .useValue(new InMemoryWorklistStore(world))
    .overrideProvider(TIMELINE_LOADS)
    .useValue(new InMemoryTimelineLoads(world))
    .overrideProvider(ADMIN_CONFIG_CLOCK)
    .useValue(() => at)
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

  /** One request under `/api/v1`; `token: null` sends no credentials. */
  const send = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    options: { token?: string | null; body?: object } = {},
  ) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    const token =
      options.token === undefined ? bearer('sub-assessor') : options.token;
    if (token !== null) call.set('Authorization', token);
    return options.body === undefined ? call : call.send(options.body);
  };

  /** Sets a user's program scope (`[]` = all programs) before their first request. */
  const programScope = (userId: number, programIds: number[]) =>
    w.programs.replaceScope(userId, programIds);

  return { app, world, users, send, programScope };
}
