// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADMIN_CONFIG_CLOCK } from '../../src/admin-config/admin-config.clock.js';
import { TIMELINE_LOADS } from '../../src/admin-config/timelines/timeline-loads.js';
import { AppModule } from '../../src/app.module.js';
import { withoutTitleBackfill } from './without-title-backfill.js';
import { FIELD_CATALOG_SOURCE } from '../../src/admin-config/field-config/field-catalog.ports.js';
import { shapeCatalog } from '../../src/admin-config/field-config/field-config-catalog.js';
import { FIELD_CONFIG_EFFECTIVE } from '../../src/admin-config/field-config/field-config.module.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../src/common/idempotency/idempotency.store.js';
import { ASSESSMENT_STORE } from '../../src/assessment/assessment.store.js';
import { ASSESSMENT_UNIT_OF_WORK } from '../../src/assessment/assessment.unit-of-work.js';
import { WORKLIST_STORE } from '../../src/assessment/worklist.store.js';
import { UpstreamUnavailableError } from '../../src/users/catalogs/catalogs.errors.js';
import { SNAPSHOT_STORE } from '../../src/ingestion/snapshot-store.port.js';
import { FakeSnapshotStore } from './fake-snapshot-store.js';
import {
  FakeClock,
  InMemoryIdempotencyStore,
} from './in-memory-idempotency.js';
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
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
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

/**
 * A response with the two per-request values of `meta` removed, so two answers
 * can be compared whole: the error body of a missing result and of one outside
 * the caller's scope must be the same bytes (FR-1).
 */
export function withoutRequestMeta(body: {
  meta?: Record<string, unknown>;
}): unknown {
  const { requestId: _requestId, timestamp: _timestamp, ...meta } =
    body.meta ?? {};
  return { ...body, meta };
}

/** `at` is the clock of the services (inside step 1 by default). */
export async function buildAssessmentApp(
  at: Date = new Date('2026-03-15T10:00:00.000Z'),
) {
  const w = adminWorld();
  const world = new InMemoryAssessmentWorld();
  // The comment create is keyed (P-17): the interceptor reserves in this store and the unit of work marks it.
  const idemClock = new FakeClock(new Date('2026-11-13T10:00:00.000Z'));
  const idempotency = new InMemoryIdempotencyStore(idemClock.now);
  world.idempotency = idempotency;
  const snapshots = new FakeSnapshotStore();
  // The Reporting catalog of every year is the 2026 fixture; `down` makes it unreadable (503).
  const fieldCatalog = shapeCatalog(
    JSON.parse(
      readFileSync(
        new URL(
          '../../src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  const catalogSource = { down: false };
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
    // Granted a result type of the 2026 Reporting catalog (the view reads that catalog).
    policy: await actor('sub-policy', [['ASSESSOR', 'policy_change']], 'Pia'),
    // A second assessor of the same kind, to write or withdraw beside `policy`.
    policy2: await actor(
      'sub-policy2',
      [['ASSESSOR', 'policy_change']],
      'Pablo',
    ),
  };

  const moduleRef = await withoutTitleBackfill(
    Test.createTestingModule({ imports: [AppModule] }),
  )
    .overrideProvider(USERS_STORE)
    .useValue(w.db.stores.users)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(w.db.stores.assignments)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(w.db.stores.programs)
    .overrideProvider(WORKLIST_STORE)
    .useValue(new InMemoryWorklistStore(world))
    .overrideProvider(ASSESSMENT_STORE)
    .useValue(new InMemoryAssessmentStore(world))
    .overrideProvider(ASSESSMENT_UNIT_OF_WORK)
    .useValue(new InMemoryAssessmentUnitOfWork(world))
    .overrideProvider(SNAPSHOT_STORE)
    .useValue(snapshots)
    .overrideProvider(FIELD_CONFIG_EFFECTIVE)
    .useValue(new FakeFieldConfigEffective(world))
    .overrideProvider(FIELD_CATALOG_SOURCE)
    .useValue({
      forYear: () =>
        catalogSource.down
          ? Promise.reject(new UpstreamUnavailableError())
          : Promise.resolve(fieldCatalog),
    })
    .overrideProvider(TIMELINE_LOADS)
    .useValue(new InMemoryTimelineLoads(world))
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(idempotency)
    .overrideProvider(IDEMPOTENCY_CLOCK)
    .useValue(idemClock.now)
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
    options: { token?: string | null; body?: object; key?: string } = {},
  ) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (options.key !== undefined) call.set('Idempotency-Key', options.key);
    const token =
      options.token === undefined ? bearer('sub-assessor') : options.token;
    if (token !== null) call.set('Authorization', token);
    return options.body === undefined ? call : call.send(options.body);
  };

  /** Sets a user's program scope (`[]` = all programs) before their first request. */
  const programScope = (userId: number, programIds: number[]) =>
    w.programs.replaceScope(userId, programIds);

  return {
    app,
    world,
    users,
    send,
    programScope,
    snapshots,
    catalogSource,
    idempotency,
  };
}
