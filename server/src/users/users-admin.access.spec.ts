import { HttpException, Logger } from '@nestjs/common';
import {
  adminWorld,
  type AdminWorld,
} from '../../test/support/users-admin-world.js';
import {
  AdmissionService,
  type AdmissionUnitOfWork,
} from '../auth/admission.service.js';
import { UpstreamUnavailableError } from '../auth/cognito-auth.client.js';
import type { TokenVerifier } from '../auth/token-verifier.service.js';
import { CurrentUserCache } from './current-user.cache.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UserProgramsRepository } from './user-programs.repository.js';
import type { AdminContext } from './users-admin.service.js';
import { UsersRepository } from './users.repository.js';

// Access emails and the recovery of a Cognito account removed from the shared
// pool: what the admin actions send, and what they write.

beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const w = adminWorld();
  const admin = await w.seedUser({
    email: 'root.admin@cgiar.org',
    nickname: 'Root',
    roles: [['ADMIN']],
    lastLoginAt: new Date('2026-10-01T00:00:00Z'),
  });
  const ctx: AdminContext = { actorId: admin.id, requestId: 'req-1' };
  return { w, admin, ctx };
}

const emails = (w: AdminWorld) => w.notifier.notify.mock.calls.map(([c]) => c);
const rowOf = (w: AdminWorld, email: string) =>
  w.db.users.find((u) => u.email === email)!;

async function failureOf(work: Promise<unknown>): Promise<HttpException> {
  try {
    await work;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to be refused, but it succeeded');
}

/** The real admission over the same tables; the verifier serves `payload`. */
function admissionOf(w: AdminWorld, payload: Record<string, unknown>) {
  const users = new UsersRepository(w.db.stores.users);
  const assignments = new RoleAssignmentsRepository(w.db.stores.assignments);
  const unitOfWork: AdmissionUnitOfWork = {
    run: (work) => work({ users, assignments }),
  };
  return new AdmissionService(
    { verifyId: async () => payload } as unknown as TokenVerifier,
    unitOfWork,
    new CurrentUserCache(
      users,
      assignments,
      new UserProgramsRepository(w.db.stores.programs),
      () => Date.now(),
    ),
  );
}

describe('access email on create', () => {
  it.each([
    ['sso', 'sso', 'sso'],
    ['custom, new pool account', 'custom', 'temporary_password'],
  ] as const)(
    '%s: one "granted" email with the roles and the sign-in path',
    async (_n, accountType, signIn) => {
      const { w, ctx } = await setup();

      await w.service.create(ctx, {
        email: 'Nia@example.org',
        firstName: 'Nia',
        lastName: 'Okoro',
        nickname: 'Nia',
        accountType,
        roles: [{ role: 'ASSESSOR', resultTypes: ['POLICY', 'KP'] }],
      });

      expect(emails(w)).toEqual([
        {
          kind: 'granted',
          email: 'nia@example.org',
          firstName: 'Nia',
          roles: [
            {
              role: 'Assessor',
              resultTypes: ['Knowledge product', 'Policy change'],
            },
          ],
          signIn,
        },
      ]);
    },
  );

  it('custom with an account already in the pool: tells them to use their current password', async () => {
    const { w, ctx } = await setup();
    w.pool.set('old@example.org', 'CONFIRMED');

    await w.service.create(ctx, {
      email: 'old@example.org',
      firstName: 'Old',
      lastName: 'Timer',
      nickname: 'Old',
      accountType: 'custom',
      roles: [{ role: 'TPB' }],
    });

    expect(emails(w)).toMatchObject([
      {
        kind: 'granted',
        signIn: 'existing_password',
        roles: [{ role: 'TPB', resultTypes: null }],
      },
    ]);
  });

  it('no roles: no email (the person still cannot sign in)', async () => {
    const { w, ctx } = await setup();
    await w.service.create(ctx, {
      email: 'x@cgiar.org',
      firstName: 'X',
      lastName: 'Y',
      nickname: 'XY',
      accountType: 'sso',
    });
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('an email failure never fails the request', async () => {
    const { w, ctx } = await setup();
    w.notifier.notify.mockRejectedValueOnce(new Error('down'));

    const created = await w.service.create(ctx, {
      email: 'z@cgiar.org',
      firstName: 'Z',
      lastName: 'Z',
      nickname: 'ZZ',
      accountType: 'sso',
      roles: [{ role: 'PPU' }],
    });

    expect(created.userId).toBeGreaterThan(0);
  });
});

describe('access email on every role change', () => {
  it('first role: granted · a change: updated · last role removed: removed', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      firstName: 'Tess',
    });

    await w.service.replaceRoles(ctx, t.id, [
      { role: 'ASSESSOR', resultTypes: 'all' },
    ]);
    await w.service.replaceRoles(ctx, t.id, [
      { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
    ]);
    await w.service.replaceRoles(ctx, t.id, []);

    expect(emails(w).map((e) => [e.kind, e.roles])).toEqual([
      ['granted', [{ role: 'Assessor', resultTypes: 'all' }]],
      [
        'updated',
        [{ role: 'Lead assessor', resultTypes: ['Knowledge product'] }],
      ],
      ['removed', []],
    ]);
    expect(emails(w)[0]).toMatchObject({
      email: 't@cgiar.org',
      firstName: 'Tess',
      signIn: 'existing_password',
    });
  });

  it('asking for the roles already held sends nothing', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['TPB']],
    });

    await w.service.replaceRoles(ctx, t.id, [{ role: 'TPB' }]);

    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('replaceUser (the drawer save) sends one email when the roles change', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['TPB']],
    });

    await w.service.replaceUser(ctx, t.id, {
      nickname: 'T2',
      roles: [{ role: 'PPU' }],
      programs: 'all',
      exclusions: [],
    });

    expect(emails(w)).toMatchObject([
      { kind: 'updated', roles: [{ role: 'PPU' }] },
    ]);
  });

  it('a deactivated user gets no email for a role change', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      isActive: false,
    });

    await w.service.replaceRoles(ctx, t.id, [{ role: 'TPB' }]);

    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('a custom user whose pool account is gone gets it back after the change: temporary password, stale sub cleared', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@example.org',
      nickname: 'T',
      firstName: 'Tess',
      lastName: 'Ng',
      lastLoginAt: new Date('2026-10-02T00:00:00Z'),
      cognito: null,
    });
    await w.users.update(t.id, { cognitoSub: 'old-sub' });

    await w.service.replaceRoles(ctx, t.id, [{ role: 'TPB' }]);

    expect(w.cognito.createUser).toHaveBeenCalledExactlyOnceWith({
      email: 't@example.org',
      givenName: 'Tess',
      familyName: 'Ng',
    });
    expect(rowOf(w, 't@example.org')).toMatchObject({
      cognitoSub: null,
      invitation: 'sent',
    });
    expect(emails(w)).toMatchObject([
      { kind: 'granted', signIn: 'temporary_password' },
    ]);
  });

  it('Cognito down after a committed role change: the change stands and the email still goes', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({ email: 't@example.org', nickname: 'T' });
    w.cognito.getUser.mockRejectedValueOnce(new UpstreamUnavailableError());

    const result = await w.service.replaceRoles(ctx, t.id, [{ role: 'TPB' }]);

    expect(result.changed).toBe(true);
    expect(emails(w)).toHaveLength(1);
  });
});

describe('deactivate and reactivate', () => {
  it('removing from the team tells a user who had roles', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['TPB']],
    });

    await w.service.deactivate(ctx, t.id);

    expect(emails(w)).toMatchObject([{ kind: 'removed', roles: [] }]);
  });

  it('reactivating a custom user removed from the pool recreates the account BEFORE the transaction, clears the sub, and sends "granted"', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 'jd@example.org',
      nickname: 'JD',
      firstName: 'Juan',
      isActive: false,
      invitation: 'existing_account',
      lastLoginAt: new Date('2026-10-02T00:00:00Z'),
      roles: [['ASSESSOR', 'KP']],
      cognito: null,
    });
    await w.users.update(t.id, { cognitoSub: 'old-sub' });
    w.calls.length = 0;

    await w.service.activate(ctx, t.id);

    expect(w.calls.slice(0, 3)).toEqual([
      'cognito:getUser',
      'cognito:createUser',
      'tx:begin',
    ]);
    expect(rowOf(w, 'jd@example.org')).toMatchObject({
      isActive: true,
      cognitoSub: null,
      invitation: 'sent',
    });
    expect(
      w.db.audit.filter((e) => e.userId === t.id).map((e) => e.action),
    ).toEqual(['reactivate', 'invitation_resend']);
    expect(emails(w)).toMatchObject([
      {
        kind: 'granted',
        signIn: 'temporary_password',
        roles: [{ role: 'Assessor', resultTypes: ['Knowledge product'] }],
      },
    ]);

    // The new pool account (new sub, verified email) links on the next sign-in.
    const admission = admissionOf(w, {
      sub: 'new-sub',
      email: 'jd@example.org',
      email_verified: true,
      'cognito:username': 'new-sub',
    });
    const { user } = await admission.resolve('token', { mode: 'login' });
    expect(user.id).toBe(t.id);
    expect(rowOf(w, 'jd@example.org').cognitoSub).toBe('new-sub');
  });

  it('reactivating while Cognito is down: 503 and nothing written', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 'jd@example.org',
      nickname: 'JD',
      isActive: false,
      cognito: null,
    });
    w.cognito.createUser.mockRejectedValueOnce(new UpstreamUnavailableError());
    const before = JSON.stringify(w.db.users);

    const error = await failureOf(w.service.activate(ctx, t.id));

    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(w.db.users)).toBe(before);
    expect(w.notifier.notify).not.toHaveBeenCalled();
  });

  it('reactivating an SSO user never calls Cognito', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 's@cgiar.org',
      nickname: 'S',
      authSource: 'sso',
      isActive: false,
      roles: [['TPB']],
    });

    await w.service.activate(ctx, t.id);

    expect(w.cognito.getUser).not.toHaveBeenCalled();
    expect(emails(w)).toMatchObject([{ kind: 'granted', signIn: 'sso' }]);
  });
});

describe('resend invitation (amended)', () => {
  it('a signed-in user whose pool account is gone: recreated, sub cleared, access email', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 'gone@example.org',
      nickname: 'Gone',
      invitation: 'sent',
      lastLoginAt: new Date('2026-10-02T00:00:00Z'),
      roles: [['TPB']],
      cognito: null,
    });
    await w.users.update(t.id, { cognitoSub: 'old-sub' });

    const result = await w.service.resendInvitation(ctx, t.id);

    expect(result.changed).toBe(true);
    expect(w.cognito.createUser).toHaveBeenCalledTimes(1);
    expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
    expect(rowOf(w, 'gone@example.org').cognitoSub).toBeNull();
    expect(w.db.audit.at(-1)).toMatchObject({
      action: 'invitation_resend',
      changes: { cognitoAccount: { before: 'missing', after: 'created' } },
    });
    expect(emails(w)).toMatchObject([
      { kind: 'granted', signIn: 'temporary_password' },
    ]);
  });

  it('an account that pre-existed in the pool but never set a password: resent, and QA now says sent', async () => {
    const { w, ctx } = await setup();
    const t = await w.seedUser({
      email: 'pending@example.org',
      nickname: 'P',
      invitation: 'existing_account',
      cognito: 'FORCE_CHANGE_PASSWORD',
    });

    await w.service.resendInvitation(ctx, t.id);

    expect(w.cognito.resendInvitation).toHaveBeenCalledExactlyOnceWith(
      'pending@example.org',
    );
    expect(rowOf(w, 'pending@example.org').invitation).toBe('sent');
    expect(w.db.audit.at(-1)).toMatchObject({
      action: 'invitation_resend',
      changes: { invitation: { before: 'existing_account', after: 'sent' } },
    });
  });
});
