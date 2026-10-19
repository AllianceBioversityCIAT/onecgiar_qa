import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CognitoAdminClient } from '../../src/auth/cognito-admin.client.js';
import { JWKS_CACHE } from '../../src/auth/token-verifier.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../../src/users/user-programs.repository.js';
import { USERS_ADMIN_UNIT_OF_WORK } from '../../src/users/users-admin.unit-of-work.js';
import { USERS_QUERY_STORE } from '../../src/users/users-query.repository.js';
import { USERS_STORE } from '../../src/users/users.repository.js';
import { InMemoryUsersAdminUnitOfWork } from './in-memory-stores.js';
import { InMemoryUsersQueryStore } from './in-memory-query-store.js';
import { localJwksCache, newKeyPair, signJwt } from './jwt-test-keys.js';
import { adminWorld, PROGRAMS, RESULT_TYPES } from './users-admin-world.js';

// The real app over the in-memory user-management world, shared by the
// privacy and audit-coverage suites: guards, pipe, filter and OpenAPI are real;
// stores, Cognito and the catalog sources are fakes.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('users-admin-app-kid');
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

export type UsersAdminApp = Awaited<ReturnType<typeof buildUsersAdminApp>>;

export async function buildUsersAdminApp() {
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
