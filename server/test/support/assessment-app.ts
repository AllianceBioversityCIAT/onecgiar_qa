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
import { RESULTS_FEED } from '../../src/ingestion/results-feed.port.js';
import { releaseConfig } from '../../src/config/release.config.js';
import { RELEASE_PAUSE } from '../../src/assessment/release.service.js';
import { RELEASE_STORE } from '../../src/assessment/release.store.js';
import { FakeResultsFeed } from './fake-results-feed.js';
import {
  AI_SUGGESTION_STORE,
  DynamoAiSuggestionStore,
  type AiSuggestionStore,
} from '../../src/ai-suggestions/ai-suggestion.store.js';
import { AI_USAGE_STORE } from '../../src/assessment/ai-usage.store.js';
import { createFakeDynamoClient } from './fake-dynamodb-client.js';
import { InMemoryAiUsageStore } from './in-memory-ai-usage.js';
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
  InMemoryReleaseStore,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
} from './in-memory-assessment.js';
import { localJwksCache, newKeyPair, signJwt } from './jwt-test-keys.js';
import { SP_ACCESS_STORE } from '../../src/assessment/sp-view/sp-access.store.js';
import {
  InMemorySpAccessStore,
  InMemorySpResponseUnitOfWork,
  InMemorySpViewStore,
} from './in-memory-sp.js';
import { SP_RESPONSE_UNIT_OF_WORK } from '../../src/assessment/sp-view/sp-response.unit-of-work.js';
import { SP_VIEW_STORE } from '../../src/assessment/sp-view/sp-view.store.js';
import { spAccessConfig } from '../../src/config/sp-access.config.js';
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
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    ...meta
  } = body.meta ?? {};
  return { ...body, meta };
}

/** `at` is the clock of the services (inside step 1 by default). */
export async function buildAssessmentApp(
  at: Date = new Date('2026-03-15T10:00:00.000Z'),
  options: {
    nicknames?: Partial<Record<'policy' | 'policy2', string>>;
    /** Planted person names (FR-22 forbids a name in any log line). */
    names?: Partial<
      Record<'policy' | 'policy2' | 'admin', { first: string; last: string }>
    >;
    /** Replaces the `spAccess` config (P2-3911): unset fields are undefined. */
    spAccess?: { apiKey?: string; reportingResultUrl?: string };
    /** Turns the release sweeper on at this interval (P2-3910); unset, the e2e env keeps it off. */
    releaseSweepIntervalMs?: number;
  } = {},
) {
  // The clock the services read; `setClock` moves it (FR-2 over HTTP).
  let current = at;
  const w = adminWorld();
  const world = new InMemoryAssessmentWorld();
  // The comment create is keyed (P-17): the interceptor reserves in this store and the unit of work marks it.
  const idemClock = new FakeClock(new Date('2026-11-13T10:00:00.000Z'));
  const idempotency = new InMemoryIdempotencyStore(idemClock.now);
  world.idempotency = idempotency;
  const snapshots = new FakeSnapshotStore();
  // Reporting's release route (T-12): nothing is scripted, so an end's release fails at once and stays pending until a test scripts the feed.
  const feed = new FakeResultsFeed();
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
  // AI suggestions (ai-suggestions T-5): the worker's items in a fake DynamoDB
  // table read by the real ElectroDB store; `down` makes every read fail.
  const aiDynamo = createFakeDynamoClient();
  const aiStore = new DynamoAiSuggestionStore(aiDynamo.client, 'cgiar-qa-test');
  const aiSource = { down: false };
  const aiSuggestions: AiSuggestionStore = {
    listForSnapshot: (...args) =>
      aiSource.down
        ? Promise.reject(new Error('dynamodb down'))
        : aiStore.listForSnapshot(...args),
  };
  const aiUsage = new InMemoryAiUsageStore(world);
  // The SP view (P2-3911): link codes and SP sessions.
  const spAccess = new InMemorySpAccessStore();
  const actor = async (
    sub: string,
    roles: Array<[string, string?]>,
    nickname: string | null = null,
    name?: { first: string; last: string },
  ) => {
    const user = await w.users.create({
      email: `${sub}@cgiar.org`,
      cognitoSub: sub,
      firstName: name?.first ?? sub,
      lastName: name?.last ?? 'Actor',
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
    admin: await actor('sub-admin', [['ADMIN']], 'Ada', options.names?.admin),
    assessor: await actor('sub-assessor', [['ASSESSOR', 'KP']], 'Ana'),
    // Granted like the assessor, but assigned to no timeline.
    other: await actor('sub-other', [['ASSESSOR', 'KP']], 'Otto'),
    guest: await actor('sub-guest', []),
    // A role that must not see the ASSESSOR quick comments (FR-12).
    tpb: await actor('sub-tpb', [['TPB']], 'Tess'),
    // Granted a result type of the 2026 Reporting catalog (the view reads that catalog).
    policy: await actor(
      'sub-policy',
      [['ASSESSOR', 'policy_change']],
      options.nicknames?.policy ?? 'Pia',
      options.names?.policy,
    ),
    // A second assessor of the same kind, to write or withdraw beside `policy`.
    policy2: await actor(
      'sub-policy2',
      [['ASSESSOR', 'policy_change']],
      options.nicknames?.policy2 ?? 'Pablo',
      options.names?.policy2,
    ),
    // A Lead Assessor of policy change (round 2, P2-3912). Appended last so no earlier id moves.
    lead: await actor('sub-lead', [['LEAD_ASSESSOR', 'policy_change']], 'Lena'),
    // The PPU (round 2, step 5, P2-3917): a global role. Appended last so no earlier id moves.
    ppu: await actor('sub-ppu', [['PPU']], 'Paz'),
  };

  const builder = withoutTitleBackfill(
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
    .overrideProvider(RESULTS_FEED)
    .useValue(feed)
    .overrideProvider(RELEASE_STORE)
    .useValue(new InMemoryReleaseStore(world))
    .overrideProvider(RELEASE_PAUSE)
    .useValue(() => Promise.resolve())
    .overrideProvider(FIELD_CONFIG_EFFECTIVE)
    .useValue(new FakeFieldConfigEffective(world))
    .overrideProvider(FIELD_CATALOG_SOURCE)
    .useValue({
      forYear: () =>
        catalogSource.down
          ? Promise.reject(new UpstreamUnavailableError())
          : Promise.resolve(fieldCatalog),
    })
    .overrideProvider(AI_SUGGESTION_STORE)
    .useValue(aiSuggestions)
    .overrideProvider(AI_USAGE_STORE)
    .useValue(aiUsage)
    .overrideProvider(SP_ACCESS_STORE)
    .useValue(spAccess)
    .overrideProvider(SP_VIEW_STORE)
    .useValue(new InMemorySpViewStore(world))
    .overrideProvider(SP_RESPONSE_UNIT_OF_WORK)
    .useValue(new InMemorySpResponseUnitOfWork(world))
    .overrideProvider(TIMELINE_LOADS)
    .useValue(new InMemoryTimelineLoads(world))
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(idempotency)
    .overrideProvider(IDEMPOTENCY_CLOCK)
    .useValue(idemClock.now)
    .overrideProvider(ADMIN_CONFIG_CLOCK)
    .useValue(() => current)
    .overrideProvider(RESULT_TYPE_SOURCE)
    .useValue({ list: async () => RESULT_TYPES })
    .overrideProvider(SCIENCE_PROGRAM_SOURCE)
    .useValue({ list: async () => PROGRAMS })
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer));
  // The SP view settings (P2-3911); the e2e env sets both by default.
  if (options.spAccess !== undefined) {
    builder.overrideProvider(spAccessConfig.KEY).useValue({
      apiKey: undefined,
      reportingResultUrl: undefined,
      ...options.spAccess,
    });
  }
  // The sweeper stays off in the e2e env (`RELEASE_SWEEP_INTERVAL_MS=0`); a test turns it on here.
  if (options.releaseSweepIntervalMs !== undefined) {
    builder
      .overrideProvider(releaseConfig.KEY)
      .useValue({ sweepIntervalMs: options.releaseSweepIntervalMs });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  /** One request under `/api/v1`; `token: null` sends no credentials. */
  const send = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    options: {
      token?: string | null;
      body?: object;
      key?: string;
      /** Extra request headers (e.g. `X-Acting-Role`, admin/acts-as-reviewer). */
      headers?: Record<string, string>;
    } = {},
  ) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (options.key !== undefined) call.set('Idempotency-Key', options.key);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      call.set(name, value);
    }
    const token =
      options.token === undefined ? bearer('sub-assessor') : options.token;
    if (token !== null) call.set('Authorization', token);
    return options.body === undefined ? call : call.send(options.body);
  };

  /** Sets a user's program scope (`[]` = all programs) before their first request. */
  const programScope = (userId: number, programIds: number[]) =>
    w.programs.replaceScope(userId, programIds);

  const setClock = (next: Date) => {
    current = next;
  };

  /** One request under `/api/v1` with an SP session token (or none). */
  const spSend = (
    method: 'get' | 'post' | 'put',
    path: string,
    token: string | null,
    body?: object,
  ) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (token !== null) call.set('Authorization', `Bearer ${token}`);
    return body === undefined ? call : call.send(body);
  };

  /**
   * The Reporting flow (P2-3911): issue a code with the e2e key, then trade it
   * for an SP session. Returns the session token.
   */
  let spLogins = 0;
  const spLogin = async (
    identity: {
      email?: string;
      name?: string;
      programCode?: string | null;
      isReportingAdmin?: boolean;
    } = {},
  ): Promise<string> => {
    const issued = await request(app.getHttpServer())
      .post('/api/v1/sp-access/codes')
      .set('x-api-key', process.env.SP_ACCESS_API_KEY!)
      .send({
        email: identity.email ?? 'sp-user@example.org',
        name: identity.name ?? 'Sam Program',
        programCode:
          identity.programCode === undefined ? 'SP01' : identity.programCode,
        isReportingAdmin: identity.isReportingAdmin ?? false,
      })
      .expect(201);
    // A fresh client address per login, so the 10/min throttle of the
    // exchange never trips a suite that logs in many times (trust proxy = 1).
    spLogins++;
    const session = await request(app.getHttpServer())
      .post('/api/v1/sp-access/session')
      .set('X-Forwarded-For', `198.51.100.${spLogins % 250}`)
      .send({ code: (issued.body as { data: { code: string } }).data.code })
      .expect(200);
    return (session.body as { data: { accessToken: string } }).data.accessToken;
  };

  return {
    app,
    world,
    setClock,
    users,
    send,
    programScope,
    snapshots,
    feed,
    catalogSource,
    idempotency,
    aiDynamo,
    aiSource,
    aiUsage,
    spAccess,
    spSend,
    spLogin,
  };
}
