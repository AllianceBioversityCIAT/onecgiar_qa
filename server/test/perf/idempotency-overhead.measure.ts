import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { CognitoAdminClient } from '../../src/auth/cognito-admin.client.js';
import { JWKS_CACHE } from '../../src/auth/token-verifier.service.js';
import { configureApp } from '../../src/common/configure-app.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
} from '../../src/common/idempotency/idempotency.store.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../../src/users/user-programs.repository.js';
import { USERS_ADMIN_UNIT_OF_WORK } from '../../src/users/users-admin.unit-of-work.js';
import { USERS_QUERY_STORE } from '../../src/users/users-query.repository.js';
import { USERS_STORE } from '../../src/users/users.repository.js';
import { InMemoryUsersQueryStore } from '../support/in-memory-query-store.js';
import {
  localJwksCache,
  newKeyPair,
  signJwt,
} from '../support/jwt-test-keys.js';
import {
  adminWorld,
  PROGRAMS,
  RESULT_TYPES,
} from '../support/users-admin-world.js';

// users-admin-write-safety T-7, NFR-3: added latency of a keyed write over an
// unkeyed one, and "a replay touches no catalog and no Cognito". ONE-OFF, not
// a test of the default suites and with NO timing assertion (it would flake CI):
//   cd server && pnpm exec vitest run --config ./vitest.config.measure.ts
// Method: the real app on a real socket, in-memory key store, warm-up first,
// then N pairs interleaved (unkeyed, keyed) so drift hits both arms alike.
// Every keyed request uses a fresh key (a reserve + purge + markExecuted +
// complete); both arms are a PATCH of one nickname.
// SCOPE: the figure is interceptor + store-call overhead on the in-memory store
// ONLY. It does not include the four MySQL round trips of a keyed write (purge
// DELETE, INSERT, markExecuted UPDATE, complete UPDATE), and the purge deletes
// nothing here (no row is ever expired). NFR-3 (p95 <= 20 ms) ON MYSQL IS AN
// OPEN GAP, recorded in docs/specs/changes/users-admin-write-safety/execution.md
// (T-7 entry); no other task measures it.

const N = Number(process.env.MEASURE_N ?? 300);
const WARMUP = 50;
const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('measure-kid');
const now = () => Math.floor(Date.now() / 1000);
const token = `Bearer ${signJwt(
  {
    sub: 'sub-admin',
    iss: ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin',
    username: 'sub-admin',
    auth_time: now(),
    iat: now(),
    exp: now() + 3600,
    jti: 'jti-measure',
  },
  signer,
)}`;

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
const summary = (label: string, samples: number[]) => {
  const s = [...samples].sort((a, b) => a - b);
  return {
    label,
    n: s.length,
    min: +s[0]!.toFixed(2),
    p25: +quantile(s, 0.25).toFixed(2),
    p50: +quantile(s, 0.5).toFixed(2),
    p75: +quantile(s, 0.75).toFixed(2),
    p95: +quantile(s, 0.95).toFixed(2),
    max: +s.at(-1)!.toFixed(2),
  };
};

describe('NFR-3 measurement (one-off)', () => {
  let app: NestExpressApplication;
  let w: ReturnType<typeof adminWorld>;
  // The catalog sources the app really reads (the world's own `catalogs` are not wired into the app).
  const resultTypeReads = vi.fn(async () => RESULT_TYPES);
  const programReads = vi.fn(async () => PROGRAMS);

  beforeAll(async () => {
    w = adminWorld();
    const admin = await w.users.create({
      email: 'sub-admin@cgiar.org',
      cognitoSub: 'sub-admin',
      firstName: 'a',
      lastName: 'b',
      authSource: 'sso',
      nickname: 'Ada',
    });
    await w.assignments.create({
      userId: admin.id,
      roleCode: 'ADMIN',
      resultTypeKey: null,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(USERS_STORE)
      .useValue(w.db.stores.users)
      .overrideProvider(ROLE_ASSIGNMENTS_STORE)
      .useValue(w.db.stores.assignments)
      .overrideProvider(USER_PROGRAMS_STORE)
      .useValue(w.db.stores.programs)
      .overrideProvider(USERS_ADMIN_UNIT_OF_WORK)
      .useValue(w.unitOfWork)
      .overrideProvider(USERS_QUERY_STORE)
      .useValue(new InMemoryUsersQueryStore(w.db))
      .overrideProvider(IDEMPOTENCY_STORE)
      .useValue(w.idempotency)
      .overrideProvider(IDEMPOTENCY_CLOCK)
      .useValue(w.clock.now)
      .overrideProvider(CognitoAdminClient)
      .useValue(w.cognito)
      .overrideProvider(RESULT_TYPE_SOURCE)
      .useValue({ list: resultTypeReads })
      .overrideProvider(SCIENCE_PROGRAM_SOURCE)
      .useValue({ list: programReads })
      .overrideProvider(JWKS_CACHE)
      .useValue(localJwksCache(signer))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    Logger.overrideLogger(false);
    await app.listen(0);
  });
  afterAll(async () => {
    await app.close();
  });

  it('keyed vs unkeyed write overhead, and a replay touches no catalog / Cognito', async () => {
    const target = await w.seedUser({
      email: 'measure.target@sample-org.example',
      nickname: 'Target',
      roles: [['TPB']],
    });
    const server = app.getHttpServer();
    let tick = 0;
    const patch = async (key?: string) => {
      const call = request(server)
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', token);
      if (key !== undefined) call.set('Idempotency-Key', key);
      const start = performance.now();
      const res = await call.send({ nickname: `Target ${++tick}` });
      const ms = performance.now() - start;
      if (res.status !== 200) throw new Error(`unexpected ${res.status}`);
      return ms;
    };

    for (let i = 0; i < WARMUP; i++) {
      await patch();
      await patch(`warm-${i}`);
    }
    const unkeyed: number[] = [];
    const keyed: number[] = [];
    for (let i = 0; i < N; i++) {
      unkeyed.push(await patch());
      keyed.push(await patch(`measure-${i}`));
    }
    const a = summary('unkeyed PATCH', unkeyed);
    const b = summary('keyed PATCH (fresh key)', keyed);
    const diffs = keyed.map((ms, i) => ms - unkeyed[i]!).sort((x, y) => x - y);
    const overhead = {
      pairs: diffs.length,
      p50: +quantile(diffs, 0.5).toFixed(2),
      p95: +quantile(diffs, 0.95).toFixed(2),
      p5: +quantile(diffs, 0.05).toFixed(2),
      p95_keyed_minus_p95_unkeyed: +(b.p95 - a.p95).toFixed(2),
    };

    // A replay answers from the store: no catalog read, no Cognito call.
    const create = {
      email: 'replay.new@sample-org.example',
      firstName: 'R',
      lastName: 'N',
      nickname: 'Replaynew',
      accountType: 'custom',
      roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }],
      programs: [1],
      exclusions: [],
    };
    const send = () =>
      request(server)
        .post('/api/v1/users')
        .set('Authorization', token)
        .set('Idempotency-Key', 'replay-probe')
        .send(create);
    const beforeFirst = {
      resultTypes: resultTypeReads.mock.calls.length,
      programs: programReads.mock.calls.length,
      create: w.cognito.createUser.mock.calls.length,
    };
    const first = await send();
    const before = {
      resultTypes: resultTypeReads.mock.calls.length,
      programs: programReads.mock.calls.length,
      create: w.cognito.createUser.mock.calls.length,
    };
    const second = await send();
    const after = {
      resultTypes: resultTypeReads.mock.calls.length,
      programs: programReads.mock.calls.length,
      create: w.cognito.createUser.mock.calls.length,
    };

    process.stdout.write(
      JSON.stringify(
        {
          N,
          WARMUP,
          store: 'in-memory',
          a,
          b,
          overhead,
          first: first.status,
          beforeFirst,
          replay: second.status,
          replayed: second.headers['idempotency-replayed'],
          before,
          after,
        },
        null,
        2,
      ) + '\n',
    );
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(after).toEqual(before);
    // The counters are live: the first, executed request did read them.
    expect(before.resultTypes).toBeGreaterThan(beforeFirst.resultTypes);
    expect(before.create).toBe(beforeFirst.create + 1);
  });
});
