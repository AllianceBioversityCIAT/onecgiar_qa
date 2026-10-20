import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { CognitoAdminClient } from '../src/auth/cognito-admin.client.js';
import { JWKS_CACHE } from '../src/auth/token-verifier.service.js';
import { configureApp } from '../src/common/configure-app.js';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_STORE,
} from '../src/common/idempotency/idempotency.store.js';
import {
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from '../src/users/catalogs/catalogs.ports.js';
import { ROLE_ASSIGNMENTS_STORE } from '../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../src/users/user-programs.repository.js';
import { USERS_ADMIN_UNIT_OF_WORK } from '../src/users/users-admin.unit-of-work.js';
import { USERS_QUERY_STORE } from '../src/users/users-query.repository.js';
import { USERS_STORE } from '../src/users/users.repository.js';
import { roundTrip } from './support/in-memory-idempotency.js';
import { InMemoryUsersQueryStore } from './support/in-memory-query-store.js';
import {
  localJwksCache,
  newKeyPair,
  signJwt,
} from './support/jwt-test-keys.js';
import { LogSpy } from './support/log-spy.js';
import {
  adminWorld,
  PROGRAMS,
  RESULT_TYPES,
} from './support/users-admin-world.js';

// users-admin-write-safety T-7 (FR-9, NFR-2): over keyed writes, nothing that
// was stored, submitted or answered reaches any log line, and the decision
// lines are the ones design 7 (Decision log) fixes:
//   first run / taken-over -> ONE `users_admin` line carrying `idempotency=`;
//   replay / in-flight / reused -> ONE `event:"idempotency"` line, no service line.
// The spy captures every sink (all `Logger` instances, the static logger,
// `console`), not one. Expected values are written out from the design.

const ISSUER = `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
const signer = newKeyPair('users-admin-idempotency-privacy-kid');
const now = () => Math.floor(Date.now() / 1000);
const adminToken = `Bearer ${signJwt(
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
    jti: 'jti-sub-admin',
  },
  signer,
)}`;

// Values that must never appear in a log line (case-insensitive): what the
// request submits, what the remembered answer holds, and the key itself.
const SUBMITTED = {
  email: 'Keyed.Newcomer@Sample-Org.example',
  firstName: 'Keyedfirst',
  lastName: 'Quartzlast',
  nickname: 'Keyednick',
  reason: 'Private-keyed-reason',
};
const TARGET = {
  email: 'keyed.target@sample-org.example',
  firstName: 'Tgtfirst',
  lastName: 'Tgtlast',
  nickname: 'Tgtnick',
};
const KEY_PREFIX = 'Sensitive-Key-Material';

const REPLAY_FIELDS = [
  'actorId',
  'event',
  'idempotency',
  'outcome',
  'requestId',
  'status',
];

interface Req {
  method: 'post' | 'put' | 'patch';
  path: string;
  body?: object;
}

async function build() {
  const w = adminWorld();
  const admin = await w.users.create({
    email: 'sub-admin@cgiar.org',
    cognitoSub: 'sub-admin',
    firstName: 'sub-admin',
    lastName: 'Actor',
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
    .useValue({ list: async () => RESULT_TYPES })
    .overrideProvider(SCIENCE_PROGRAM_SOURCE)
    .useValue({ list: async () => PROGRAMS })
    .overrideProvider(JWKS_CACHE)
    .useValue(localJwksCache(signer))
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { ...w, app, admin };
}

describe('NFR-2 / FR-9: keyed writes log ids and the idempotency outcome only', () => {
  let w: Awaited<ReturnType<typeof build>>;
  const spy = new LogSpy();
  let serial = 0;
  let secrets: string[];

  beforeEach(async () => {
    spy.lines.length = 0;
    serial = 0;
    w = await build();
    spy.attach();
    secrets = [
      ...Object.values(SUBMITTED),
      ...Object.values(TARGET),
      'keyed.newcomer',
      'sample-org.example',
      KEY_PREFIX,
      adminToken.replace('Bearer ', ''),
      'sub-admin@cgiar.org',
    ].map((s) => s.toLowerCase());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  const newKey = () => `${KEY_PREFIX}-${++serial}`;

  const send = (req: Req, key: string) => {
    const call = request(w.app.getHttpServer())
      [req.method](`/api/v1${req.path}`)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', key);
    return req.body === undefined ? call : call.send(req.body);
  };

  const requestIdOf = (res: request.Response) =>
    res.headers['x-request-id'] as string;

  const expectNoSecret = () => {
    const haystack = spy.lines.join('\n').toLowerCase();
    for (const secret of secrets) expect(haystack).not.toContain(secret);
  };

  /** Every captured line that names this request, whatever its event. */
  const linesOf = (requestId: string) =>
    spy.lines.filter((line) => line.includes(requestId));

  const seedTarget = () =>
    w.seedUser({
      ...TARGET,
      invitation: 'sent',
      roles: [['TPB']],
    });

  /** One entry per keyed write route family; bodies carry values that must stay out of the logs. */
  async function routes(): Promise<Array<[string, Req, number]>> {
    const t = await seedTarget();
    const reporting = await seedTarget2();
    return [
      [
        'POST /users',
        {
          method: 'post',
          path: '/users',
          body: {
            email: SUBMITTED.email,
            firstName: SUBMITTED.firstName,
            lastName: SUBMITTED.lastName,
            nickname: SUBMITTED.nickname,
            accountType: 'custom',
            roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }],
            programs: [1, 2],
            exclusions: [{ programId: 1, reason: SUBMITTED.reason }],
          },
        },
        201,
      ],
      [
        'PATCH /users/:id',
        {
          method: 'patch',
          path: `/users/${t.id}`,
          body: { nickname: 'Tgtnick-renamed' },
        },
        200,
      ],
      [
        'PUT /users/:id',
        {
          method: 'put',
          path: `/users/${reporting.id}`,
          body: {
            nickname: 'Saved-nickname',
            roles: [{ role: 'PPU' }],
            programs: [1],
            exclusions: [{ programId: 2, reason: SUBMITTED.reason }],
          },
        },
        200,
      ],
      [
        'PUT /users/:id/roles',
        {
          method: 'put',
          path: `/users/${t.id}/roles`,
          body: { roles: [{ role: 'PPU' }] },
        },
        200,
      ],
      [
        'POST /users/:id/exclusions',
        {
          method: 'post',
          path: `/users/${t.id}/exclusions`,
          body: { programId: 3, reason: SUBMITTED.reason },
        },
        201,
      ],
      [
        'POST /users/:id/deactivate',
        { method: 'post', path: `/users/${t.id}/deactivate` },
        200,
      ],
    ];
  }

  const seedTarget2 = () =>
    w.seedUser({
      email: 'keyed.second@sample-org.example',
      firstName: 'Secondfirst',
      lastName: 'Secondlast',
      nickname: 'Secondnick',
      invitation: 'sent',
      roles: [['TPB']],
    });

  it('first run: exactly one users_admin line with idempotency=none, no idempotency-event line, nothing personal', async () => {
    secrets.push(
      'keyed.second@sample-org.example',
      'secondfirst',
      'secondlast',
    );
    secrets.push('secondnick', 'tgtnick-renamed', 'saved-nickname');
    for (const [name, req, status] of await routes()) {
      const res = await send(req, newKey());
      expect(res.status, name).toBe(status);
      const id = requestIdOf(res);
      const decisions = spy.decisionsOf(id);
      expect(decisions, name).toHaveLength(1);
      expect(decisions[0], name).toMatchObject({
        event: 'users_admin',
        outcome: 'ok',
        actorId: w.admin.id,
        idempotency: 'none',
      });
      expect(spy.eventsOf('idempotency', id), name).toHaveLength(0);
      expect(linesOf(id), name).toHaveLength(1);
    }
    expectNoSecret();
  });

  it('replay: exactly one line, the replay line, and no service decision line', async () => {
    secrets.push(
      'keyed.second@sample-org.example',
      'secondfirst',
      'secondlast',
    );
    secrets.push('secondnick', 'tgtnick-renamed', 'saved-nickname');
    for (const [name, req, status] of await routes()) {
      const key = newKey();
      const first = await send(req, key);
      expect(first.status, name).toBe(status);
      spy.lines.length = 0;

      const replay = await send(req, key);
      expect(replay.status, name).toBe(status);
      expect(replay.headers['idempotency-replayed'], name).toBe('true');
      expect(replay.body.data, name).toEqual(first.body.data);

      const id = requestIdOf(replay);
      expect(spy.decisionsOf(id), name).toHaveLength(0);
      const events = spy.eventsOf('idempotency', id);
      expect(events, name).toEqual([
        {
          event: 'idempotency',
          idempotency: 'replayed',
          outcome: 'replayed',
          status,
          actorId: w.admin.id,
          requestId: id,
        },
      ]);
      expect(Object.keys(events[0]!).sort(), name).toEqual(REPLAY_FIELDS);
      // Nothing else was printed for this request, by any logger.
      expect(linesOf(id), name).toHaveLength(1);
      expectNoSecret();
    }
  });

  it('a replayed refusal writes the replay line only, and keeps the stored refusal out of the logs', async () => {
    const holder = await seedTarget();
    const other = await seedTarget2();
    secrets.push(
      'keyed.second@sample-org.example',
      'secondfirst',
      'secondlast',
    );
    secrets.push('secondnick');
    const req: Req = {
      method: 'patch',
      path: `/users/${other.id}`,
      body: { nickname: holder.nickname },
    };
    const key = newKey();
    const first = await send(req, key);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('USERS_NICKNAME_TAKEN');
    spy.lines.length = 0;

    const replay = await send(req, key);
    expect(replay.status).toBe(409);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    const id = requestIdOf(replay);
    expect(spy.decisionsOf(id)).toHaveLength(0);
    expect(spy.eventsOf('idempotency', id)).toEqual([
      {
        event: 'idempotency',
        idempotency: 'replayed',
        outcome: 'replayed',
        status: 409,
        actorId: w.admin.id,
        requestId: id,
      },
    ]);
    expect(linesOf(id)).toHaveLength(1);
    expectNoSecret();
  });

  it('key reused with another request: one idempotency line (reused, 422) and no service line', async () => {
    const t = await seedTarget();
    const key = newKey();
    const first = await send(
      { method: 'patch', path: `/users/${t.id}`, body: { nickname: 'One' } },
      key,
    );
    expect(first.status).toBe(200);
    spy.lines.length = 0;

    const reused = await send(
      { method: 'patch', path: `/users/${t.id}`, body: { nickname: 'Two' } },
      key,
    );
    expect(reused.status).toBe(422);
    const id = requestIdOf(reused);
    expect(spy.decisionsOf(id)).toHaveLength(0);
    expect(spy.eventsOf('idempotency', id)).toEqual([
      {
        event: 'idempotency',
        idempotency: 'reused',
        outcome: 'refused',
        status: 422,
        actorId: w.admin.id,
        requestId: id,
      },
    ]);
    expect(linesOf(id)).toHaveLength(1);
    expectNoSecret();
  });

  it('request in flight: one idempotency line (in_progress, 409) and no service line', async () => {
    const t = await seedTarget();
    const req: Req = { method: 'post', path: `/users/${t.id}/deactivate` };
    const key = newKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const inside = new Promise<void>((resolve) => (reached = resolve));
    w.unitOfWork.beforeMark = async () => {
      reached();
      await gate;
    };
    const first = send(req, key).then((res) => res);
    await inside;
    spy.lines.length = 0;

    const second = await send(req, key);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    const id = requestIdOf(second);
    expect(spy.decisionsOf(id)).toHaveLength(0);
    expect(spy.eventsOf('idempotency', id)).toEqual([
      {
        event: 'idempotency',
        idempotency: 'in_progress',
        outcome: 'refused',
        status: 409,
        actorId: w.admin.id,
        requestId: id,
      },
    ]);
    expect(linesOf(id)).toHaveLength(1);

    release();
    expect((await first).status).toBe(200);
    expectNoSecret();
  });

  it('take-over: the taker writes one users_admin line with idempotency=taken_over and no idempotency-event line', async () => {
    const t = await seedTarget();
    const req: Req = { method: 'post', path: `/users/${t.id}/deactivate` };
    const key = newKey();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const inside = new Promise<void>((resolve) => (reached = resolve));
    let held = false;
    w.unitOfWork.beforeMark = async () => {
      if (held) return; // the taker passes straight through
      held = true;
      reached();
      await gate;
    };
    const stalled = send(req, key).then((res) => res);
    await inside;
    const stalledToken = w.idempotency.peek(w.admin.id, key)!.ownerToken;
    w.clock.advance(IDEMPOTENCY_LEASE_MS + 1_000);

    const taker = send(req, key).then((res) => res);
    for (let turn = 0; turn < 500; turn++) {
      if (w.idempotency.peek(w.admin.id, key)!.ownerToken !== stalledToken)
        break;
      await roundTrip();
    }
    release();
    const [lost, won] = await Promise.all([stalled, taker]);
    expect(won.status).toBe(200);
    expect(lost.status).toBe(409);

    const id = requestIdOf(won);
    const decisions = spy.decisionsOf(id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      event: 'users_admin',
      outcome: 'ok',
      idempotency: 'taken_over',
    });
    expect(spy.eventsOf('idempotency', id)).toHaveLength(0);
    expect(linesOf(id)).toHaveLength(1);
    expectNoSecret();
  });

  it('key store down: 503, nothing personal or stored in any line, no service line', async () => {
    const t = await seedTarget();
    w.idempotency.failNext(
      new Error('db down: Keyed.Newcomer@Sample-Org.example'),
    );
    const res = await send(
      {
        method: 'patch',
        path: `/users/${t.id}`,
        body: { nickname: SUBMITTED.nickname, firstName: SUBMITTED.firstName },
      },
      newKey(),
    );
    expect(res.status).toBe(503);
    expect(spy.decisionsOf(requestIdOf(res))).toHaveLength(0);
    // The store's own error text carried an email: it must not be printed.
    expectNoSecret();
  });
});
