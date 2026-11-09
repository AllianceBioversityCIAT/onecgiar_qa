// @akili-spec ingestion/step-1-loads
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ADMIN_CONFIG_CLOCK } from '../../src/admin-config/admin-config.clock.js';
import { FIELD_CATALOG_SOURCE } from '../../src/admin-config/field-config/field-catalog.ports.js';
import type { RomeMinute } from '../../src/admin-config/rome-date.js';
import { TIMELINES_STORE } from '../../src/admin-config/timelines/timelines.store.js';
import { AppModule } from '../../src/app.module.js';
import { JWKS_CACHE } from '../../src/auth/token-verifier.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../src/common/idempotency/idempotency.store.js';
import type { Cycle } from '../../src/database/drizzle/schema/cycles.js';
import { RESULTS_FEED } from '../../src/ingestion/results-feed.port.js';
import type {
  FeedDetailsQuery,
  FeedIntakeQuery,
  FeedReleaseQuery,
  FeedListItem,
  FeedListQuery,
  FeedPage,
} from '../../src/ingestion/results-feed.port.js';
import { SNAPSHOT_STORE } from '../../src/ingestion/snapshot-store.port.js';
import { LOADS_STORE } from '../../src/ingestion/loads.store.js';
import { LOADS_TRANSACTIONS } from '../../src/ingestion/loads.unit-of-work.js';
import { ROLE_ASSIGNMENTS_STORE } from '../../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../../src/users/user-programs.repository.js';
import { USERS_STORE } from '../../src/users/users.repository.js';
import { FakeResultsFeed } from './fake-results-feed.js';
import { FakeSnapshotStore } from './fake-snapshot-store.js';
import { InMemoryAdminConfigDatabase } from './in-memory-admin-config.js';
import { FakeClock } from './in-memory-idempotency.js';
import {
  InMemoryLoadsDatabase,
  InMemoryLoadsTransactions,
} from './in-memory-loads.js';
import { localJwksCache, newKeyPair, signJwt } from './jwt-test-keys.js';
import { adminWorld } from './users-admin-world.js';

// The real app over the in-memory loads world (pattern of `admin-config-app.ts`):
// guards, pipe, filter, interceptors, the loads service, the unit of work and the
// runner are real; the users stores, the timelines store, the loads stores, the
// key store, the clocks, the Reporting feed, the snapshot store and the catalog
// are fakes. `feed: 'real'` keeps `ReportingResultsFeedClient`, so a test can
// stub `fetch` and see what the real adapter would send and log.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('ingestion-app-kid');
const now = () => Math.floor(Date.now() / 1000);

/** 2026-11-10 09:00 in Rome (UTC+1 after the clock change of 25 Oct). */
export const NOW = new Date('2026-11-10T08:00:00.000Z');

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

/** The nickname of the admin who starts loads: a person field that must come back in the list and never reach a log. */
export const ADMIN_NICKNAME = 'Quartznick';

const SCOPE = {
  programIds: [2, 3],
  resultTypeKeys: ['knowledge_product', 'policy_change'],
};

function cycleRow(id: number, status: Cycle['status']): Cycle {
  const created = new Date('2026-10-01T09:00:00.000Z');
  return {
    id,
    year: 2025 + id,
    status,
    activeKey: status === 'active' ? 1 : null,
    createdAt: created,
    createdBy: 1,
    activatedAt: status === 'draft' ? null : created,
    activatedBy: status === 'draft' ? null : 1,
    closedAt: status === 'closed' ? created : null,
    closedBy: status === 'closed' ? 1 : null,
  };
}

/** A timeline of three steps, scope SP02 + SP03 and KP + policy change. */
function addTimeline(
  admin: InMemoryAdminConfigDatabase,
  seed: { id: number; cycleId: number; name: string; step1Closes: string },
): void {
  const created = new Date('2026-10-01T09:00:00.000Z');
  admin.timelines.push({
    id: seed.id,
    cycleId: seed.cycleId,
    name: seed.name,
    kind: 'additional',
    officialKey: null,
    allPrograms: false,
    allResultTypes: false,
    createdAt: created,
    createdBy: 1,
    version: 1,
    updatedAt: null,
    updatedBy: null,
  });
  const audiences = ['assessors', 'programs', 'lead_assessors'] as const;
  const moments = [
    ['2026-11-02T09:00', seed.step1Closes],
    ['2026-11-23T09:00', '2026-12-04T17:30'],
    ['2026-12-07T09:00', '2026-12-18T17:30'],
  ] as const;
  moments.forEach(([opensAt, closesAt], index) => {
    admin.steps.push({
      id: seed.id * 10 + index + 1,
      timelineId: seed.id,
      position: index + 1,
      name: `Step ${index + 1}`,
      audience: audiences[index]!,
      opensAt: opensAt as RomeMinute,
      closesAt: closesAt as RomeMinute,
      round: 1,
      requiresLoad: index === 0,
    });
  });
  for (const programId of SCOPE.programIds) {
    admin.programs.push({ timelineId: seed.id, programId });
  }
  for (const resultTypeKey of SCOPE.resultTypeKeys) {
    admin.resultTypes.push({ timelineId: seed.id, resultTypeKey });
  }
}

/** Result n of the listing: code 1000+n, id 5000+n; the first `kps` are KPs, the rest policy changes (all SP02). */
export const feedItem = (n: number, kps: number): FeedListItem => ({
  resultId: 5000 + n,
  resultCode: 1000 + n,
  program: { clarisaId: 2, code: 'SP02' },
  resultTypeKey: n <= kps ? 'knowledge_product' : 'policy_change',
  submittedAt: '2026-10-01T00:00:00.000Z',
});

/** A KP whose details put it in the `not_in_qa` group (design 7.5): a book that is not MELIA. */
const KP_BOOK = {
  'knowledge_product.type': 'Book',
  'knowledge_product.is_melia': false,
};

/** What a feed of `total` results answers: every page, every intake, every details (a title per result). */
export function scriptFeed(
  feed: FakeResultsFeed,
  { total, kps = 0 }: { total: number; kps?: number },
): FeedListItem[] {
  const listed = Array.from({ length: total }, (_, i) => feedItem(i + 1, kps));
  const typeOf = new Map(listed.map((i) => [i.resultId, i.resultTypeKey]));
  feed.script('list', (q: FeedListQuery): FeedPage => {
    const size = q.pageSize ?? 200;
    const page = q.page ?? 1;
    return {
      phase: q.phaseYear,
      page,
      pageSize: size,
      total: listed.length,
      breakdown: { byProgram: [], byResultType: [] },
      items: listed.slice((page - 1) * size, page * size),
    };
  });
  feed.script('intake', (q: FeedIntakeQuery) => ({
    phaseYear: q.phaseYear,
    taken: q.resultIds.map((id) => ({
      resultId: id,
      resultCode: id - 4000,
      changed: true,
    })),
    notTaken: [],
  }));
  // FR-14 (on since 2026-11-04): a load releases its not-in-QA / auto-checked KPs.
  feed.script('release', (q: FeedReleaseQuery) => ({
    phaseYear: q.phaseYear,
    released: q.items.map((i) => ({
      resultId: i.resultId,
      resultCode: i.resultId - 4000,
      outcome: i.outcome,
    })),
    notReleased: [],
  }));
  feed.script('details', (q: FeedDetailsQuery) => ({
    phase: q.phaseYear,
    catalogVersion: '1.29',
    notEligible: [],
    results: q.resultIds.map((id) => ({
      resultId: id,
      resultCode: id - 4000,
      resultTypeKey: typeOf.get(id)!,
      values:
        typeOf.get(id) === 'knowledge_product'
          ? KP_BOOK
          : { title: `Result title ${id}` },
    })),
  }));
  return listed;
}

export type IngestionApp = Awaited<ReturnType<typeof buildIngestionApp>>;

/**
 * Timeline 13 with every step closed before the fixed clock (2026-11-10 09:00
 * Rome): the last step closed at 08:59, one minute ago, so the sync window of
 * FR-1 (judged on the LAST step) is closed.
 */
export function closeAllStepsOfTimeline13(w: IngestionApp): void {
  const [, second, last] = w.world.steps
    .filter((s) => s.timelineId === 13)
    .sort((a, b) => a.position - b.position);
  second!.opensAt = '2026-11-09T18:00' as typeof second.opensAt;
  second!.closesAt = '2026-11-09T20:00' as typeof second.closesAt;
  last!.opensAt = '2026-11-09T21:00' as typeof last.opensAt;
  last!.closesAt = '2026-11-10T08:59' as typeof last.closesAt;
}

/**
 * Cycle 1 (active, 2026) with timelines 11 "July 2026" and 12 "August 2026"
 * (step 1 closes 2026-11-20 17:30), 13 "September 2026" (step 1 closed on
 * 9 Nov); cycle 3 (closed, 2028) with timeline 31. Admin "sub-admin" and one
 * user per other role. The clock stands at `NOW`.
 */
export async function buildIngestionApp(
  options: { feed?: 'fake' | 'real' } = {},
) {
  const w = adminWorld();
  const admin = new InMemoryAdminConfigDatabase(w.db);
  const loadsWorld = new InMemoryLoadsDatabase(admin);
  const transactions = new InMemoryLoadsTransactions(loadsWorld);
  admin.cycles.push(cycleRow(1, 'active'), cycleRow(3, 'closed'));
  addTimeline(admin, {
    id: 11,
    cycleId: 1,
    name: 'July 2026',
    step1Closes: '2026-11-20T17:30',
  });
  addTimeline(admin, {
    id: 12,
    cycleId: 1,
    name: 'August 2026',
    step1Closes: '2026-11-20T17:30',
  });
  addTimeline(admin, {
    id: 13,
    cycleId: 1,
    name: 'September 2026',
    step1Closes: '2026-11-09T17:30',
  });
  addTimeline(admin, {
    id: 31,
    cycleId: 3,
    name: 'Old cycle',
    step1Closes: '2026-11-20T17:30',
  });

  const feed = new FakeResultsFeed();
  const snapshots = new FakeSnapshotStore();
  const catalogs = {
    /** Phase years the catalog was read for, in order. */
    requested: [] as number[],
  };
  const catalog = {
    forYear: async (year: number) => {
      catalogs.requested.push(year);
      return { catalogVersion: '1.29' } as never;
    },
    refresh: async (year: number) => {
      catalogs.requested.push(year);
      return { catalogVersion: '1.29' } as never;
    },
  };
  const clock = new FakeClock(NOW);

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
  const adminUser = await actor('sub-admin', [['ADMIN']], ADMIN_NICKNAME);
  await actor('sub-admin2', [['ADMIN']], 'Secondnick');
  await actor('sub-assessor', [['ASSESSOR', 'KP']]);
  await actor('sub-lead_assessor', [['LEAD_ASSESSOR', '*']]);
  await actor('sub-multi_grant', [['ASSESSOR', 'KP'], ['TPB']]);
  await actor('sub-tpb', [['TPB']]);
  await actor('sub-ppu', [['PPU']]);
  await actor('sub-guest', []);

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USERS_STORE)
    .useValue(w.db.stores.users)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(w.db.stores.assignments)
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(w.db.stores.programs)
    .overrideProvider(TIMELINES_STORE)
    .useValue(admin.timelineStore)
    .overrideProvider(LOADS_STORE)
    .useValue(loadsWorld.store)
    .overrideProvider(LOADS_TRANSACTIONS)
    .useValue(transactions)
    .overrideProvider(SNAPSHOT_STORE)
    .useValue(snapshots)
    .overrideProvider(FIELD_CATALOG_SOURCE)
    .useValue(catalog)
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(w.idempotency)
    .overrideProvider(IDEMPOTENCY_CLOCK)
    .useValue(w.clock.now)
    .overrideProvider(ADMIN_CONFIG_CLOCK)
    .useValue(clock.now)
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer));
  if (options.feed !== 'real') {
    builder = builder.overrideProvider(RESULTS_FEED).useValue(feed);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  /** One request; `key` adds an `Idempotency-Key`, `token: null` sends no credentials. */
  const send = (
    method: 'get' | 'post',
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

  /** Polls the list of a timeline until no load is `running`; the run is in the background. */
  const settled = async (timelineId: number) => {
    for (let turn = 0; turn < 400; turn++) {
      const res = await send('get', `/timelines/${timelineId}/loads`);
      if (res.status !== 200) {
        throw new Error(
          `the list of timeline ${timelineId} answered ${res.status}`,
        );
      }
      const loads = res.body.data as Array<{ status: string }>;
      if (loads.every((l) => l.status !== 'running')) return loads;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`a load of timeline ${timelineId} never settled`);
  };

  return {
    ...w,
    admin: adminUser,
    app,
    world: admin,
    loadsWorld,
    transactions,
    feed,
    snapshots,
    catalogs,
    clock,
    send,
    settled,
  };
}
