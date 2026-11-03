import { Logger } from '@nestjs/common';
import type request from 'supertest';
import { LogSpy } from './support/log-spy.js';
import {
  buildUsersAdminApp,
  type UsersAdminApp,
} from './support/users-admin-app.js';

// NFR-2 (no email, name, nickname, temporary password or key in any log) and
// FR-13 (every mutation writes exactly the audit rows the design fixes, and a
// refused request writes none), both over the real HTTP path. Expected values
// are written out from the spec (design 7 steps 5, Logging; DD-15).

const LEVELS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const;

// Values that must never appear in a log line (case-insensitive).
const SUBMITTED = {
  email: 'Zelda.Qatest@Sample-Org.example',
  firstName: 'Zeldafirst',
  lastName: 'Quartzlast',
  nickname: 'Zeldanick',
  reason: 'Private-conflict-reason',
};

const requestIdOf = (res: request.Response) =>
  res.headers['x-request-id'] as string;

describe('NFR-2: no personal data or key in any log, on every mutation route', () => {
  let w: UsersAdminApp;
  const spy = new LogSpy();
  let secrets: string[];

  beforeEach(async () => {
    spy.lines.length = 0;
    w = await buildUsersAdminApp();
    spy.attach();
    secrets = [
      SUBMITTED.email,
      'zelda.qatest',
      'sample-org.example',
      SUBMITTED.firstName,
      SUBMITTED.lastName,
      SUBMITTED.nickname,
      SUBMITTED.reason,
      'temp-password-9x',
      'tgt1@sample-org.example',
      'Tgtfirst',
      'Tgtlast',
      'Tgtnick',
      'sub-admin@cgiar.org',
      'cgiar.org',
      w.adminToken.replace('Bearer ', ''),
      process.env.CLARISA_API_KEY!,
      process.env.COGNITO_CLIENT_SECRET!,
      process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY!,
      process.env.COGNITO_ADMIN_ACCESS_KEY_ID!,
    ].map((s) => s.toLowerCase());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  const asAdmin = (
    method: Parameters<UsersAdminApp['call']>[0],
    path: string,
    body?: object,
  ) => w.call(method, path, w.adminToken, body);

  const seedTarget = (
    over: Partial<Parameters<UsersAdminApp['seedUser']>[0]> = {},
  ) =>
    w.seedUser({
      email: 'tgt1@sample-org.example',
      nickname: 'Tgtnick',
      firstName: 'Tgtfirst',
      lastName: 'Tgtlast',
      roles: [['TPB']],
      ...over,
    });

  const expectNoSecret = () => {
    const haystack = spy.lines.join('\n').toLowerCase();
    for (const secret of secrets) expect(haystack).not.toContain(secret);
  };

  const create = {
    email: SUBMITTED.email,
    firstName: SUBMITTED.firstName,
    lastName: SUBMITTED.lastName,
    nickname: SUBMITTED.nickname,
    accountType: 'custom',
    roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }, { role: 'TPB' }],
    programs: [1, 2],
    exclusions: [{ programId: 1, reason: SUBMITTED.reason }],
  };

  it('logs exactly one fixed-field decision line per mutation and nothing personal, over every route', async () => {
    const user = await seedTarget();
    const sso = await seedTarget({
      email: 'tgt2@sample-org.example',
      nickname: 'Tgtnick2',
      authSource: 'sso',
    });
    const invitee = await seedTarget({
      email: 'tgt3@sample-org.example',
      nickname: 'Tgtnick3',
      invitation: 'sent',
    });
    secrets.push('tgt2@sample-org.example', 'tgt3@sample-org.example');
    secrets.push('tgtnick2', 'tgtnick3');
    await w.db.stores.programs.insertExclusion({
      userId: user.id,
      programId: 3,
      origin: 'reporting',
      reportingRole: 'Lead',
      createdBy: null,
    });
    const reporting = w.db.exclusions.find((e) => e.origin === 'reporting')!;

    const u = `/users/${user.id}`;
    type Step = [
      string,
      Parameters<UsersAdminApp['call']>[0],
      string,
      object | undefined,
      number,
      string,
    ];
    const steps: Step[] = [
      ['create_custom', 'post', '/users', create, 201, 'create'],
      [
        'create_sso',
        'post',
        '/users',
        {
          ...create,
          email: 'sso.new@sample-org.example',
          nickname: 'Ssonick',
          accountType: 'sso',
          roles: [],
          programs: undefined,
          exclusions: undefined,
        },
        201,
        'create',
      ],
      [
        'edit',
        'patch',
        u,
        { nickname: 'Tgtnick-new', firstName: 'Tgtfirst2' },
        200,
        'edit',
      ],
      [
        'roles',
        'put',
        `${u}/roles`,
        { roles: [{ role: 'PPU' }] },
        200,
        'roles',
      ],
      ['programs', 'put', `${u}/programs`, { programs: [1] }, 200, 'programs'],
      [
        'exclusion_add',
        'post',
        `${u}/exclusions`,
        { programId: 2, reason: SUBMITTED.reason },
        201,
        'exclusion_add',
      ],
      [
        'exclusion_dismiss',
        'post',
        `${u}/exclusions/${reporting.id}/dismiss`,
        { reason: SUBMITTED.reason },
        200,
        'exclusion_dismiss',
      ],
      ['deactivate', 'post', `${u}/deactivate`, undefined, 200, 'deactivate'],
      ['activate', 'post', `${u}/activate`, undefined, 200, 'activate'],
      [
        'invitation',
        'post',
        `/users/${invitee.id}/invitation`,
        undefined,
        200,
        'invitation_resend',
      ],
    ];
    secrets.push(
      'sso.new@sample-org.example',
      'ssonick',
      'tgtnick-new',
      'tgtfirst2',
    );
    void sso;

    const expectOkLine = (
      name: string,
      res: request.Response,
      action: string,
    ) => {
      const decisions = spy.decisionsOf(requestIdOf(res));
      expect(decisions, name).toHaveLength(1);
      expect(Object.keys(decisions[0]!).sort(), name).toEqual([
        'action',
        'actorId',
        'event',
        'idempotency',
        'outcome',
        'requestId',
        'targetId',
      ]);
      expect(decisions[0], name).toMatchObject({
        outcome: 'ok',
        actorId: w.admin.id,
        action,
      });
    };

    for (const [name, method, path, body, status, action] of steps) {
      const res = await asAdmin(method, path, body);
      expect(res.status, name).toBe(status);
      expectOkLine(name, res, action);
    }

    // Remove the manual exclusion added above (needs its id).
    const manual = w.db.exclusions.find(
      (e) => e.origin === 'manual' && e.userId === user.id,
    )!;
    const removed = await asAdmin('delete', `${u}/exclusions/${manual.id}`);
    expect(removed.status).toBe(200);
    expectOkLine('exclusion_remove', removed, 'exclusion_remove');

    expectNoSecret();
    // The spy saw the app log at all (a spy on a silent app proves nothing).
    expect(spy.lines.filter((l) => l.includes('users_admin'))).toHaveLength(
      steps.length + 1,
    );
  });

  it('logs each service refusal as exactly one fixed-field line (outcome refused, the catalog code as reason) and nothing personal; a pipe refusal never reaches the service and logs no decision', async () => {
    const user = await seedTarget();
    await seedTarget({
      email: 'tgt9@sample-org.example',
      nickname: 'Taken-nick',
    });
    secrets.push('tgt9@sample-org.example', 'taken-nick');
    type Refusal = [
      method: Parameters<UsersAdminApp['call']>[0],
      path: string,
      body: object | undefined,
      status: number,
      code: string,
      // null: refused by the validation pipe, before the service runs.
      logged: { action: string; targetId: number | null } | null,
    ];
    const refusals: Refusal[] = [
      [
        'post',
        '/users',
        { ...create, email: 'tgt9@sample-org.example' },
        409,
        'USERS_EMAIL_TAKEN',
        { action: 'create', targetId: null },
      ],
      [
        'post',
        '/users',
        { ...create, nickname: 'Taken-nick' },
        409,
        'USERS_NICKNAME_TAKEN',
        { action: 'create', targetId: null },
      ],
      [
        'patch',
        '/users/99999',
        { nickname: 'x' },
        404,
        'USERS_NOT_FOUND',
        { action: 'edit', targetId: 99999 },
      ],
      [
        'post',
        `/users/${w.admin.id}/deactivate`,
        undefined,
        409,
        'USERS_LAST_ADMIN',
        { action: 'deactivate', targetId: w.admin.id },
      ],
      [
        'post',
        `/users/${user.id}/invitation`,
        undefined,
        409,
        'USERS_INVITATION_NOT_APPLICABLE',
        { action: 'invitation_resend', targetId: user.id },
      ],
      [
        'post',
        '/users',
        { ...create, programs: [] },
        400,
        'VALIDATION_FAILED',
        null,
      ],
      [
        'put',
        `/users/${user.id}/roles`,
        { roles: [{ role: 'PPU', resultTypes: ['KP'] }] },
        400,
        'VALIDATION_FAILED',
        { action: 'roles', targetId: user.id },
      ],
    ];
    let logged = 0;
    for (const [method, path, body, status, code, line] of refusals) {
      const name = `${method} ${path} -> ${code}`;
      const res = await asAdmin(method, path, body);
      expect(res.status, name).toBe(status);
      expect(res.body.error.code, name).toBe(code);
      const decisions = spy.decisionsOf(requestIdOf(res));
      if (line === null) {
        expect(decisions, name).toEqual([]);
        continue;
      }
      logged++;
      expect(decisions, name).toHaveLength(1);
      expect(Object.keys(decisions[0]!).sort(), name).toEqual([
        'action',
        'actorId',
        'event',
        'idempotency',
        'outcome',
        'reason',
        'requestId',
        'targetId',
      ]);
      expect(decisions[0], name).toMatchObject({
        event: 'users_admin',
        outcome: 'refused',
        reason: code,
        actorId: w.admin.id,
        ...line,
      });
    }
    // The spy saw the refusals (a spy on a silent app proves nothing).
    expect(
      spy.lines.filter((l) => l.includes('"outcome":"refused"')),
    ).toHaveLength(logged);
    expectNoSecret();
  });

  it('logs a forced 5xx (Cognito fails with an error that carries the email) without its message, through the service and the exception filter', async () => {
    w.cognito.createUser.mockRejectedValueOnce(
      new Error(`boom for ${SUBMITTED.email} password temp-password-9x`),
    );
    const res = await asAdmin('post', '/users', create);
    expect(res.status).toBe(500);
    const unhandled = spy.lines.filter((l) => l.includes('unhandled_error'));
    expect(unhandled).toHaveLength(1); // the filter logged: the spy sees it
    expect(spy.decisionsOf(requestIdOf(res))).toHaveLength(1);
    expect(spy.decisionsOf(requestIdOf(res))[0]).toMatchObject({
      outcome: 'error',
      reason: 'internal_error',
    });
    expectNoSecret();
  });

  it('writes ONE decision line when Cognito resent the invitation but QA could not record it', async () => {
    const invitee = await seedTarget({ invitation: 'sent' });
    w.cognito.resendInvitation.mockImplementationOnce(async () => {
      await w.users.update(invitee.id, { lastLoginAt: new Date() });
      return 'resent';
    });
    const res = await asAdmin('post', `/users/${invitee.id}/invitation`);
    expect(res.status).toBe(409);
    const decisions = spy.decisionsOf(requestIdOf(res));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      outcome: 'error',
      reason: 'cognito_sent_not_recorded',
    });
    expectNoSecret();
  });
});

describe('FR-13: audit coverage over HTTP (DD-15)', () => {
  let w: UsersAdminApp;

  beforeEach(async () => {
    for (const level of LEVELS) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    w = await buildUsersAdminApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await w.app.close();
  });

  const asAdmin = (
    method: Parameters<UsersAdminApp['call']>[0],
    path: string,
    body?: object,
  ) => w.call(method, path, w.adminToken, body);

  /** The audit rows one request added: `[action, userId]` pairs, plus the rows. */
  async function rowsOf(
    send: () => request.Test,
    status: number,
  ): Promise<
    Array<{
      action: string;
      userId: number;
      requestId: string;
      actorId: number;
      changes: Record<string, unknown>;
    }>
  > {
    const before = w.db.audit.length;
    const res = await send();
    expect(res.status).toBe(status);
    const added = w.db.audit.slice(before) as Array<{
      action: string;
      userId: number;
      requestId: string;
      actorId: number;
      changes: Record<string, unknown>;
    }>;
    for (const row of added) {
      expect(row.actorId).toBe(w.admin.id);
      expect(row.requestId).toBe(res.headers['x-request-id']);
    }
    return added;
  }

  const actions = (rows: Array<{ action: string }>) =>
    rows.map((r) => r.action).sort();

  it('create = one create row plus one per grant, scope and exclusion', async () => {
    const rows = await rowsOf(
      () =>
        asAdmin('post', '/users', {
          email: 'new@sample-org.example',
          firstName: 'N',
          lastName: 'P',
          nickname: 'Newbie',
          accountType: 'custom',
          roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }, { role: 'TPB' }],
          programs: [1, 2],
          exclusions: [{ programId: 1, reason: 'Co-author' }],
        }),
      201,
    );
    expect(actions(rows)).toEqual([
      'create',
      'exclusion_add',
      'role_grant',
      'role_grant',
      'scope_change',
    ]);
  });

  it('edit with two fields = exactly one update row holding both', async () => {
    const user = await w.seedUser({
      email: 'e@sample-org.example',
      nickname: 'E',
      firstName: 'A',
      lastName: 'B',
      roles: [['TPB']],
    });
    const rows = await rowsOf(
      () =>
        asAdmin('patch', `/users/${user.id}`, {
          nickname: 'E2',
          firstName: 'A2',
        }),
      200,
    );
    expect(actions(rows)).toEqual(['update']);
    expect(Object.keys(rows[0]!.changes).sort()).toEqual([
      'firstName',
      'nickname',
    ]);
  });

  it('roles = one row per grant and per revoke', async () => {
    const user = await w.seedUser({
      email: 'r@sample-org.example',
      nickname: 'R',
      roles: [['TPB']],
    });
    const rows = await rowsOf(
      () =>
        asAdmin('put', `/users/${user.id}/roles`, {
          roles: [
            { role: 'LEAD_ASSESSOR', resultTypes: ['KP', 'POLICY'] },
            { role: 'PPU' },
          ],
        }),
      200,
    );
    expect(actions(rows)).toEqual([
      'role_grant',
      'role_grant',
      'role_grant',
      'role_revoke',
    ]);
  });

  it('programs, exclusion add/remove/dismiss, deactivate, activate and the invitation resend = exactly one row each', async () => {
    const user = await w.seedUser({
      email: 'p@sample-org.example',
      nickname: 'P',
      invitation: 'sent',
      roles: [['TPB']],
    });
    const u = `/users/${user.id}`;
    expect(
      actions(
        await rowsOf(
          () => asAdmin('put', `${u}/programs`, { programs: [1, 2] }),
          200,
        ),
      ),
    ).toEqual(['scope_change']);
    expect(
      actions(
        await rowsOf(
          () =>
            asAdmin('post', `${u}/exclusions`, { programId: 3, reason: 'r' }),
          201,
        ),
      ),
    ).toEqual(['exclusion_add']);
    const manual = w.db.exclusions.find((e) => e.userId === user.id)!;
    expect(
      actions(
        await rowsOf(
          () => asAdmin('delete', `${u}/exclusions/${manual.id}`),
          200,
        ),
      ),
    ).toEqual(['exclusion_remove']);
    await w.db.stores.programs.insertExclusion({
      userId: user.id,
      programId: 1,
      origin: 'reporting',
      reportingRole: 'Lead',
      createdBy: null,
    });
    const reporting = w.db.exclusions.find((e) => e.origin === 'reporting')!;
    expect(
      actions(
        await rowsOf(
          () =>
            asAdmin('post', `${u}/exclusions/${reporting.id}/dismiss`, {
              reason: 'ok',
            }),
          200,
        ),
      ),
    ).toEqual(['exclusion_dismiss']);
    expect(
      actions(await rowsOf(() => asAdmin('post', `${u}/invitation`), 200)),
    ).toEqual(['invitation_resend']);
    expect(
      actions(await rowsOf(() => asAdmin('post', `${u}/deactivate`), 200)),
    ).toEqual(['deactivate']);
    expect(
      actions(await rowsOf(() => asAdmin('post', `${u}/activate`), 200)),
    ).toEqual(['reactivate']);
  });

  it('a refused request writes no audit row', async () => {
    const user = await w.seedUser({
      email: 'z@sample-org.example',
      nickname: 'Z',
      roles: [['TPB']],
    });
    await w.seedUser({ email: 'z2@sample-org.example', nickname: 'Z2' });
    const before = w.db.audit.length;
    const refused: Array<
      [Parameters<UsersAdminApp['call']>[0], string, object | undefined, number]
    > = [
      ['post', `/users/${w.admin.id}/deactivate`, undefined, 409], // last admin
      ['patch', `/users/${user.id}`, { nickname: 'Z2' }, 409], // nickname taken
      ['put', `/users/${user.id}/programs`, { programs: [] }, 400], // validation
      [
        'post',
        `/users/${user.id}/exclusions`,
        { programId: 99, reason: 'r' },
        400,
      ],
      ['post', '/users/99999/activate', undefined, 404],
    ];
    for (const [method, path, body, status] of refused) {
      const res = await asAdmin(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(status);
    }
    expect(w.db.audit.length).toBe(before);
  });
});

describe('Unknown keys inside nested items (FR-13 hand-off, T-8)', () => {
  let w: UsersAdminApp;

  beforeEach(async () => {
    for (const level of LEVELS) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    w = await buildUsersAdminApp();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await w.app.close();
  });

  const fieldsOf = (res: request.Response) =>
    (res.body.error.fields as Array<{ field: string; code: string }>).map(
      ({ field, code }) => [field, code],
    );

  it('answers 400 UNKNOWN_FIELD with the bracket path', async () => {
    const user = await w.seedUser({
      email: 'n@sample-org.example',
      nickname: 'N',
      roles: [['TPB']],
    });
    const roles = await w.call('put', `/users/${user.id}/roles`, w.adminToken, {
      roles: [{ role: 'PPU', programId: 1 }],
    });
    expect(roles.status).toBe(400);
    expect(fieldsOf(roles)).toEqual([['roles[0].programId', 'UNKNOWN_FIELD']]);

    const created = await w.call('post', '/users', w.adminToken, {
      email: 'x@sample-org.example',
      firstName: 'X',
      lastName: 'Y',
      nickname: 'Xy',
      accountType: 'sso',
      exclusions: [{ programId: 1, reason: 'r', createdBy: 5 }],
    });
    expect(created.status).toBe(400);
    expect(fieldsOf(created)).toEqual([
      ['exclusions[0].createdBy', 'UNKNOWN_FIELD'],
    ]);
  });
});
