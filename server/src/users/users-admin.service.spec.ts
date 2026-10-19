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
import { UserInactiveError } from '../auth/auth.errors.js';
import type { TokenVerifier } from '../auth/token-verifier.service.js';
import { UpstreamUnavailableError as CatalogUnavailableError } from './catalogs/catalogs.errors.js';
import { CurrentUserCache } from './current-user.cache.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UserProgramsRepository } from './user-programs.repository.js';
import { UsersRepository } from './users.repository.js';
import type { AdminContext } from './users-admin.service.js';

// Expected values come from requirements.md FR-2…FR-8, FR-13 (scenarios of
// the task) and design 7, written out as literals. Every refusal asserts the
// negative as well: no row, no audit event, Cognito not called, no cache
// invalidation (never only the status).

const ADMIN_EMAIL = 'root.admin@cgiar.org';

/** Every line the service logs, in order, whichever level; the console stays quiet. */
const logged: string[] = [];
beforeEach(() => {
  logged.length = 0;
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const w = adminWorld();
  const admin = await w.seedUser({
    email: ADMIN_EMAIL,
    nickname: 'Root',
    roles: [['ADMIN']],
    lastLoginAt: new Date('2026-10-01T00:00:00Z'),
  });
  const ctx: AdminContext = { actorId: admin.id, requestId: 'req-1' };
  return { w, admin, ctx };
}

const command = (over: Record<string, unknown> = {}) => ({
  email: 'New.User@CGIAR.org',
  firstName: 'Nia',
  lastName: 'Okoro',
  nickname: 'Nia O',
  accountType: 'sso' as const,
  ...over,
});

/** The real admission service over the same in-memory tables, with a verifier that serves `payload`. */
function admissionOf(w: AdminWorld, payload: Record<string, unknown>) {
  const usersRepo = new UsersRepository(w.db.stores.users);
  const assignments = new RoleAssignmentsRepository(w.db.stores.assignments);
  const verifier = {
    verifyId: async () => payload,
  } as unknown as TokenVerifier;
  const unitOfWork: AdmissionUnitOfWork = {
    run: (work) => work({ users: usersRepo, assignments }),
  };
  return new AdmissionService(
    verifier,
    unitOfWork,
    new CurrentUserCache(
      usersRepo,
      assignments,
      new UserProgramsRepository(w.db.stores.programs),
      () => Date.now(),
    ),
  );
}

async function failureOf(work: Promise<unknown>): Promise<HttpException> {
  try {
    await work;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected the call to be refused, but it succeeded');
}

const bodyOf = (error: HttpException) =>
  error.getResponse() as {
    code: string;
    fields?: Array<{ field: string; code: string }>;
  };

/** Writes every table sees, to assert that a refusal changed nothing at all. */
function expectUntouched(w: AdminWorld, before: string) {
  expect(w.snapshot()).toBe(before);
  expect(w.cache.invalidate).not.toHaveBeenCalled();
}

const auditOf = (w: AdminWorld) =>
  w.db.audit.map(({ action, userId, actorId, changes, requestId }) => ({
    action,
    userId,
    actorId,
    changes,
    requestId,
  }));
const rowOf = (w: AdminWorld, email: string) =>
  w.db.users.find((u) => u.email === email);
const activeGrants = (w: AdminWorld, userId: number) =>
  w.db.assignments
    .filter((a) => a.userId === userId && a.isActive)
    .map((a) => {
      const role = w.db.roles.find((r) => r.id === a.roleId)!;
      return `${role.code}:${a.resultTypeKey ?? ''}`;
    })
    .sort();

describe('UsersAdminService.create (FR-2)', () => {
  describe('SSO user', () => {
    it('creates an active QA user with the nickname, the actor as creator, one audit event, and no Cognito call', async () => {
      const { w, admin, ctx } = await setup();

      const result = await w.service.create(ctx, command());

      const row = rowOf(w, 'new.user@cgiar.org')!;
      expect(result).toEqual({ userId: row.id, invitation: 'none' });
      expect(row).toMatchObject({
        isActive: true,
        authSource: 'sso',
        nickname: 'Nia O',
        firstName: 'Nia',
        lastName: 'Okoro',
        cognitoSub: null,
        invitation: 'none',
        invitedAt: null,
        createdBy: admin.id,
      });
      expect(w.cognito.getUser).not.toHaveBeenCalled();
      expect(w.cognito.createUser).not.toHaveBeenCalled();
      expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
      expect(auditOf(w).filter((e) => e.userId === row.id)).toEqual([
        {
          action: 'create',
          userId: row.id,
          actorId: admin.id,
          requestId: 'req-1',
          changes: {
            email: { before: null, after: 'new.user@cgiar.org' },
            firstName: { before: null, after: 'Nia' },
            lastName: { before: null, after: 'Okoro' },
            nickname: { before: null, after: 'Nia O' },
            accountType: { before: null, after: 'sso' },
          },
        },
      ]);
    });

    it('is linked, not created as GUEST, when the person first signs in with SSO (P-1, through AdmissionService)', async () => {
      const { w, ctx } = await setup();
      const created = await w.service.create(
        ctx,
        command({ roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }] }),
      );
      const admission = admissionOf(w, {
        sub: 'sso-sub-1',
        email: 'New.User@CGIAR.org',
        identities: [{ providerName: 'CGIAR-AzureAD' }],
        given_name: 'Nia',
        family_name: 'Okoro',
      });

      const { user } = await admission.resolve('token', { mode: 'login' });

      expect(user.id).toBe(created.userId);
      expect(
        w.db.users.filter((u) => u.email === 'new.user@cgiar.org'),
      ).toHaveLength(1);
      expect(rowOf(w, 'new.user@cgiar.org')!.cognitoSub).toBe('sso-sub-1');
      expect(
        user.assignments.map((a) => `${a.roleCode}:${a.resultTypeKey}`),
      ).toEqual(['ASSESSOR:KP']);
    });
  });

  describe('custom user', () => {
    it('new to the pool: looks the account up first, then creates it with the given names, and records invitation sent', async () => {
      const { w, ctx } = await setup();

      const result = await w.service.create(
        ctx,
        command({ accountType: 'custom' }),
      );

      expect(w.calls.filter((c) => c.startsWith('cognito'))).toEqual([
        'cognito:getUser',
        'cognito:createUser',
      ]);
      expect(w.cognito.getUser).toHaveBeenCalledWith('new.user@cgiar.org');
      expect(w.cognito.createUser).toHaveBeenCalledWith({
        email: 'new.user@cgiar.org',
        givenName: 'Nia',
        familyName: 'Okoro',
      });
      const row = rowOf(w, 'new.user@cgiar.org')!;
      expect(result.invitation).toBe('sent');
      expect(row).toMatchObject({ authSource: 'custom', invitation: 'sent' });
      expect(row.invitedAt).toBeInstanceOf(Date);
    });

    it('with an account already in the pool: creates only the QA record, writes nothing to Cognito, reports existing_account', async () => {
      const { w, ctx } = await setup();
      w.cognito.getUser.mockResolvedValueOnce({ status: 'CONFIRMED' });

      const result = await w.service.create(
        ctx,
        command({ accountType: 'custom' }),
      );

      expect(result.invitation).toBe('existing_account');
      expect(w.cognito.createUser).not.toHaveBeenCalled();
      expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
      expect(rowOf(w, 'new.user@cgiar.org')).toMatchObject({
        invitation: 'existing_account',
        invitedAt: null,
      });
    });

    it('when the account appears between the lookup and the create (race), reports existing_account', async () => {
      const { w, ctx } = await setup();
      w.cognito.createUser.mockResolvedValueOnce('existing_account');

      const result = await w.service.create(
        ctx,
        command({ accountType: 'custom' }),
      );

      expect(result.invitation).toBe('existing_account');
      expect(rowOf(w, 'new.user@cgiar.org')!.invitedAt).toBeNull();
    });

    it('calls Cognito before the transaction begins, and never inside it', async () => {
      const { w, ctx } = await setup();
      w.calls.length = 0;

      await w.service.create(ctx, command({ accountType: 'custom' }));

      expect(w.calls).toEqual([
        'cognito:getUser',
        'cognito:createUser',
        'tx:begin',
        'tx:commit',
      ]);
    });
  });

  describe('Cognito unavailable', () => {
    it.each([
      ['the lookup fails', 'getUser'],
      ['the create fails', 'createUser'],
    ] as const)(
      '%s: 503 AUTH_SERVICE_UNAVAILABLE, no QA record, no audit event, no transaction',
      async (_name, failing) => {
        const { w, ctx } = await setup();
        w.cognito[failing].mockRejectedValueOnce(
          new UpstreamUnavailableError(),
        );
        const before = w.snapshot();
        w.calls.length = 0;

        const error = await failureOf(
          w.service.create(ctx, command({ accountType: 'custom' })),
        );

        expect(error.getStatus()).toBe(503);
        expect(bodyOf(error).code).toBe('AUTH_SERVICE_UNAVAILABLE');
        expect(w.calls).not.toContain('tx:begin');
        expectUntouched(w, before);
      },
    );

    describe('one 10 s budget (NFR-3) shared by the lookup and the create', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      const after = <T>(ms: number, value: T) =>
        new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

      it('answers 503 at 10 s when each call takes 6 s (12 s together), and leaves no record', async () => {
        const { w, ctx } = await setup();
        w.cognito.getUser.mockImplementation(() => after(6_000, null));
        w.cognito.createUser.mockImplementation(() => after(6_000, 'created'));
        const before = w.snapshot();

        const pending = failureOf(
          w.service.create(ctx, command({ accountType: 'custom' })),
        );
        await vi.advanceTimersByTimeAsync(9_999);
        let settled = false;
        void pending.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const error = await pending;

        expect(error.getStatus()).toBe(503);
        expect(bodyOf(error).code).toBe('AUTH_SERVICE_UNAVAILABLE');
        // The create was already in flight and may still land in the pool:
        // accepted by DD-7, reported as existing_account on retry. QA has no row.
        await vi.advanceTimersByTimeAsync(20_000);
        expectUntouched(w, before);
      });

      it('succeeds when the two calls together stay under 10 s (4 s + 4 s)', async () => {
        const { w, ctx } = await setup();
        w.cognito.getUser.mockImplementation(() => after(4_000, null));
        w.cognito.createUser.mockImplementation(() => after(4_000, 'created'));

        const pending = w.service.create(
          ctx,
          command({ accountType: 'custom' }),
        );
        await vi.advanceTimersByTimeAsync(8_000);

        await expect(pending).resolves.toMatchObject({ invitation: 'sent' });
        expect(rowOf(w, 'new.user@cgiar.org')).toBeDefined();
      });
    });
  });

  describe('validation and uniqueness', () => {
    it.each([
      [
        'a malformed email',
        { email: 'not-an-email' },
        [{ field: 'email', code: 'INVALID_EMAIL' }],
      ],
      [
        'an empty first name',
        { firstName: '   ' },
        [{ field: 'firstName', code: 'REQUIRED' }],
      ],
      [
        'an empty last name',
        { lastName: '' },
        [{ field: 'lastName', code: 'REQUIRED' }],
      ],
      [
        'an empty nickname',
        { nickname: ' ' },
        [{ field: 'nickname', code: 'REQUIRED' }],
      ],
      [
        'a nickname over 50 characters',
        { nickname: 'n'.repeat(51) },
        [{ field: 'nickname', code: 'TOO_LONG' }],
      ],
      [
        'an unknown role',
        { roles: [{ role: 'WIZARD' }] },
        [{ field: 'roles[0].role', code: 'INVALID' }],
      ],
      [
        'the non-grantable PROGRAM role',
        { roles: [{ role: 'PROGRAM', resultTypes: ['KP'] }] },
        [{ field: 'roles[0].role', code: 'INVALID' }],
      ],
      [
        'an unknown result type',
        { roles: [{ role: 'ASSESSOR', resultTypes: ['KP', 'NOPE'] }] },
        [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
      ],
      [
        'an unknown program',
        { programs: [1, 99] },
        [{ field: 'programs', code: 'INVALID' }],
      ],
      [
        'an unknown program in an exclusion',
        { exclusions: [{ programId: 99, reason: 'conflict' }] },
        [{ field: 'exclusions[0].programId', code: 'INVALID' }],
      ],
      [
        'an exclusion without a reason',
        { exclusions: [{ programId: 1, reason: '  ' }] },
        [{ field: 'exclusions[0].reason', code: 'REQUIRED' }],
      ],
    ])(
      'rejects %s with VALIDATION_FAILED on the field; nothing is called or written',
      async (_name, over, fields) => {
        const { w, ctx } = await setup();
        const before = w.snapshot();
        w.calls.length = 0;

        const error = await failureOf(
          w.service.create(ctx, command({ accountType: 'custom', ...over })),
        );

        expect(error.getStatus()).toBe(400);
        expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
        expect(bodyOf(error).fields).toMatchObject(fields);
        expect(w.calls).toEqual([]);
        expectUntouched(w, before);
      },
    );

    it('reports every invalid field at once, not only the first', async () => {
      const { w, ctx } = await setup();

      const error = await failureOf(
        w.service.create(ctx, command({ firstName: '', nickname: '' })),
      );

      expect(bodyOf(error).fields?.map((f) => f.field)).toEqual([
        'firstName',
        'nickname',
      ]);
    });

    it('answers 409 USERS_EMAIL_TAKEN for an email already in QA, whatever its case, before calling Cognito', async () => {
      const { w, ctx } = await setup();
      await w.seedUser({ email: 'taken@cgiar.org', nickname: 'Other' });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.create(
          ctx,
          command({ accountType: 'custom', email: 'TAKEN@cgiar.ORG' }),
        ),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_EMAIL_TAKEN');
      expect(w.calls.filter((c) => c.startsWith('cognito'))).toEqual([]);
      expectUntouched(w, before);
    });

    it('answers 409 USERS_NICKNAME_TAKEN for a nickname already used, whatever its case', async () => {
      const { w, ctx } = await setup();
      await w.seedUser({ email: 'other@cgiar.org', nickname: 'Nia O' });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.create(
          ctx,
          command({ accountType: 'custom', nickname: 'nia o' }),
        ),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_NICKNAME_TAKEN');
      expect(w.calls.filter((c) => c.startsWith('cognito'))).toEqual([]);
      expectUntouched(w, before);
    });

    it('answers 503 SERVICE_UNAVAILABLE when a catalog has no copy, before any Cognito call or transaction', async () => {
      const { w, ctx } = await setup();
      w.catalogs.listResultTypes.mockRejectedValueOnce(
        new CatalogUnavailableError(),
      );
      const before = w.snapshot();
      w.calls.length = 0;

      const error = await failureOf(
        w.service.create(
          ctx,
          command({
            accountType: 'custom',
            roles: [{ role: 'ASSESSOR', resultTypes: ['KP'] }],
          }),
        ),
      );

      expect(error.getStatus()).toBe(503);
      expect(bodyOf(error).code).toBe('SERVICE_UNAVAILABLE');
      expect(w.calls).toEqual([]);
      expectUntouched(w, before);
    });
  });

  describe('a failed creation leaves nothing behind', () => {
    it('a nickname taken by a concurrent creator after the Cognito call: 409, Cognito was called, but no QA row, no audit', async () => {
      const { w, ctx } = await setup();
      w.cognito.createUser.mockImplementationOnce(async () => {
        w.calls.push('cognito:createUser');
        // Someone else commits the same nickname while Cognito answers.
        await w.seedUser({ email: 'racer@cgiar.org', nickname: 'Nia O' });
        return 'created';
      });

      const error = await failureOf(
        w.service.create(ctx, command({ accountType: 'custom' })),
      );

      expect(w.cognito.createUser).toHaveBeenCalledTimes(1);
      expect(bodyOf(error).code).toBe('USERS_NICKNAME_TAKEN');
      expect(rowOf(w, 'new.user@cgiar.org')).toBeUndefined();
      // Only the racer's own row was added; nothing of ours, no audit event.
      expect(w.db.users.map((u) => u.email).sort()).toEqual([
        'racer@cgiar.org',
        ADMIN_EMAIL,
      ]);
      expect(w.db.audit.filter((e) => e.action === 'create')).toEqual([]);
    });

    it('an email taken by a concurrent creator: 409 USERS_EMAIL_TAKEN, no second row', async () => {
      const { w, ctx } = await setup();
      w.cognito.createUser.mockImplementationOnce(async () => {
        await w.seedUser({ email: 'new.user@cgiar.org', nickname: 'Racer' });
        return 'created';
      });

      const error = await failureOf(
        w.service.create(ctx, command({ accountType: 'custom' })),
      );

      expect(bodyOf(error).code).toBe('USERS_EMAIL_TAKEN');
      expect(
        w.db.users.filter((u) => u.email === 'new.user@cgiar.org'),
      ).toHaveLength(1);
      expect(w.db.audit.filter((e) => e.action === 'create')).toEqual([]);
    });

    it('a role conflict found after the user row was inserted rolls the whole creation back (row, grants, scope, exclusions, audit)', async () => {
      const { w, ctx } = await setup();
      const before = w.snapshot();

      const error = await failureOf(
        w.service.create(
          ctx,
          command({
            roles: [
              { role: 'ASSESSOR', resultTypes: ['KP'] },
              { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
            ],
            programs: [1],
            exclusions: [{ programId: 2, reason: 'conflict' }],
          }),
        ),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_ROLE_CONFLICT');
      expect(w.calls.at(-1)).toBe('tx:rollback');
      expectUntouched(w, before);
    });
  });

  it('writes the grants, the program scope and the exclusions, with one audit event per change', async () => {
    const { w, admin, ctx } = await setup();

    const { userId } = await w.service.create(
      ctx,
      command({
        roles: [
          { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
          { role: 'ASSESSOR', resultTypes: ['INNOVATION_DEV', 'POLICY'] },
          { role: 'TPB' },
        ],
        programs: [1, 3],
        exclusions: [{ programId: 3, reason: 'Former colleague' }],
      }),
    );

    expect(activeGrants(w, userId)).toEqual([
      'ASSESSOR:INNOVATION_DEV',
      'ASSESSOR:POLICY',
      'LEAD_ASSESSOR:KP',
      'TPB:',
    ]);
    expect(
      w.db.scope.filter((s) => s.userId === userId).map((s) => s.programId),
    ).toEqual([1, 3]);
    expect(w.db.exclusions.filter((e) => e.userId === userId)).toMatchObject([
      {
        programId: 3,
        origin: 'manual',
        status: 'active',
        reason: 'Former colleague',
        createdBy: admin.id,
      },
    ]);
    expect(
      auditOf(w)
        .filter((e) => e.userId === userId)
        .map((e) => e.action),
    ).toEqual([
      'create',
      'role_grant',
      'role_grant',
      'role_grant',
      'role_grant',
      'scope_change',
      'exclusion_add',
    ]);
  });
});

describe('UsersAdminService.edit (FR-5, DD-8)', () => {
  it('changes the nickname: one audit event with before and after, the target invalidated after the commit', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
      firstName: 'Ed',
      lastName: 'Ward',
    });
    w.calls.length = 0;

    const result = await w.service.edit(ctx, target.id, { nickname: 'Edd' });

    expect(result).toEqual({ userId: target.id, changed: true });
    expect(rowOf(w, 'ed@cgiar.org')!.nickname).toBe('Edd');
    expect(auditOf(w).filter((e) => e.userId === target.id)).toEqual([
      {
        action: 'update',
        userId: target.id,
        actorId: admin.id,
        requestId: 'req-1',
        changes: { nickname: { before: 'Eddy', after: 'Edd' } },
      },
    ]);
    expect(w.cache.invalidate).toHaveBeenCalledTimes(1);
    expect(w.calls.filter((c) => /^(tx:|invalidate)/.test(c))).toEqual([
      'tx:begin',
      'tx:commit',
      `invalidate:${target.id}`,
    ]);
  });

  it('keeps the email as it is: an email in the patch is ignored', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
    });

    await w.service.edit(ctx, target.id, {
      nickname: 'Edd',
      email: 'someone.else@cgiar.org',
    } as never);

    expect(rowOf(w, 'ed@cgiar.org')!.nickname).toBe('Edd');
    expect(rowOf(w, 'someone.else@cgiar.org')).toBeUndefined();
    expect(auditOf(w).flatMap((e) => Object.keys(e.changes))).not.toContain(
      'email',
    );
  });

  it('refuses a nickname another user has, whatever the case: 409 USERS_NICKNAME_TAKEN and nothing changes', async () => {
    const { w, ctx } = await setup();
    await w.seedUser({ email: 'a@cgiar.org', nickname: 'Alpha' });
    const target = await w.seedUser({ email: 'b@cgiar.org', nickname: 'Beta' });
    const before = w.snapshot();

    const error = await failureOf(
      w.service.edit(ctx, target.id, { nickname: 'ALPHA' }),
    );

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error).code).toBe('USERS_NICKNAME_TAKEN');
    expectUntouched(w, before);
  });

  it('lets a user change only the case of their own nickname', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 'b@cgiar.org', nickname: 'beta' });

    await w.service.edit(ctx, target.id, { nickname: 'Beta' });

    expect(rowOf(w, 'b@cgiar.org')!.nickname).toBe('Beta');
  });

  it('changes the name while the user has never signed in, and audits both fields in one event', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
      firstName: 'Ed',
      lastName: 'Ward',
      lastLoginAt: null,
    });

    await w.service.edit(ctx, target.id, {
      firstName: 'Edward',
      lastName: 'Warden',
    });

    expect(rowOf(w, 'ed@cgiar.org')).toMatchObject({
      firstName: 'Edward',
      lastName: 'Warden',
    });
    expect(auditOf(w).filter((e) => e.userId === target.id)).toMatchObject([
      {
        action: 'update',
        changes: {
          firstName: { before: 'Ed', after: 'Edward' },
          lastName: { before: 'Ward', after: 'Warden' },
        },
      },
    ]);
  });

  it.each([['firstName'], ['lastName']] as const)(
    'refuses a changed %s after the first sign-in: 409 USERS_NAME_LOCKED, nothing changes',
    async (field) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({
        email: 'ed@cgiar.org',
        nickname: 'Eddy',
        firstName: 'Ed',
        lastName: 'Ward',
        lastLoginAt: new Date('2026-10-02T09:00:00Z'),
      });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.edit(ctx, target.id, { [field]: 'Changed', nickname: 'New' }),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_NAME_LOCKED');
      expectUntouched(w, before);
    },
  );

  it('after the first sign-in the nickname still changes, and the same name sent again is not an error', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
      firstName: 'Ed',
      lastName: 'Ward',
      lastLoginAt: new Date('2026-10-02T09:00:00Z'),
    });

    await w.service.edit(ctx, target.id, {
      nickname: 'Edd',
      firstName: 'Ed',
      lastName: 'Ward',
    });

    expect(rowOf(w, 'ed@cgiar.org')).toMatchObject({
      nickname: 'Edd',
      firstName: 'Ed',
    });
    expect(
      auditOf(w).filter((e) => e.userId === target.id)[0]?.changes,
    ).toEqual({ nickname: { before: 'Eddy', after: 'Edd' } });
  });

  it('rejects an empty or over-long nickname and name with VALIDATION_FAILED on the field', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
    });
    const before = w.snapshot();

    const error = await failureOf(
      w.service.edit(ctx, target.id, {
        nickname: 'x'.repeat(51),
        firstName: ' ',
      }),
    );

    expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
    expect(bodyOf(error).fields).toMatchObject([
      { field: 'nickname', code: 'TOO_LONG' },
      { field: 'firstName', code: 'REQUIRED' },
    ]);
    expectUntouched(w, before);
  });

  it('writes nothing, audits nothing and invalidates nothing when the patch changes nothing', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'ed@cgiar.org',
      nickname: 'Eddy',
    });
    const before = w.snapshot();

    const result = await w.service.edit(ctx, target.id, { nickname: 'Eddy' });

    expect(result).toEqual({ userId: target.id, changed: false });
    expectUntouched(w, before);
  });
});

describe('every action on an unknown user (FR-5 "Unknown user")', () => {
  it.each([
    [
      'edit',
      (w: AdminWorld, c: AdminContext) =>
        w.service.edit(c, 9999, { nickname: 'x' }),
    ],
    [
      'replaceRoles',
      (w: AdminWorld, c: AdminContext) =>
        w.service.replaceRoles(c, 9999, [{ role: 'TPB' }]),
    ],
    [
      'replacePrograms',
      (w: AdminWorld, c: AdminContext) =>
        w.service.replacePrograms(c, 9999, [1]),
    ],
    [
      'addExclusion',
      (w: AdminWorld, c: AdminContext) =>
        w.service.addExclusion(c, 9999, { programId: 1, reason: 'r' }),
    ],
    [
      'removeExclusion',
      (w: AdminWorld, c: AdminContext) => w.service.removeExclusion(c, 9999, 1),
    ],
    [
      'dismissExclusion',
      (w: AdminWorld, c: AdminContext) =>
        w.service.dismissExclusion(c, 9999, 1, 'r'),
    ],
    [
      'deactivate',
      (w: AdminWorld, c: AdminContext) => w.service.deactivate(c, 9999),
    ],
    [
      'activate',
      (w: AdminWorld, c: AdminContext) => w.service.activate(c, 9999),
    ],
    [
      'resendInvitation',
      (w: AdminWorld, c: AdminContext) => w.service.resendInvitation(c, 9999),
    ],
  ])(
    '%s: 404 USERS_NOT_FOUND, no audit, no invalidation, Cognito not called',
    async (_name, act) => {
      const { w, ctx } = await setup();
      const before = w.snapshot();

      const error = await failureOf(act(w, ctx));

      expect(error.getStatus()).toBe(404);
      expect(bodyOf(error).code).toBe('USERS_NOT_FOUND');
      expect(w.calls.filter((c) => c.startsWith('cognito'))).toEqual([]);
      expectUntouched(w, before);
    },
  );
});

describe('UsersAdminService.replaceRoles (FR-3, FR-7)', () => {
  it('Lead Assessor for type A and Assessor for type B both hold; one grant event each', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });

    const result = await w.service.replaceRoles(ctx, target.id, [
      { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
      { role: 'ASSESSOR', resultTypes: ['INNOVATION_DEV'] },
    ]);

    expect(result).toEqual({ userId: target.id, changed: true });
    expect(activeGrants(w, target.id)).toEqual([
      'ASSESSOR:INNOVATION_DEV',
      'LEAD_ASSESSOR:KP',
    ]);
    expect(auditOf(w).filter((e) => e.userId === target.id)).toEqual([
      {
        action: 'role_grant',
        userId: target.id,
        actorId: admin.id,
        requestId: 'req-1',
        changes: {
          role: { before: null, after: 'LEAD_ASSESSOR' },
          resultType: { before: null, after: 'KP' },
        },
      },
      {
        action: 'role_grant',
        userId: target.id,
        actorId: admin.id,
        requestId: 'req-1',
        changes: {
          role: { before: null, after: 'ASSESSOR' },
          resultType: { before: null, after: 'INNOVATION_DEV' },
        },
      },
    ]);
  });

  it("stores 'all' as one * grant that covers future types, and audits it as all", async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });

    await w.service.replaceRoles(ctx, target.id, [
      { role: 'LEAD_ASSESSOR', resultTypes: 'all' },
    ]);

    expect(activeGrants(w, target.id)).toEqual(['LEAD_ASSESSOR:*']);
    expect(auditOf(w).at(-1)?.changes).toEqual({
      role: { before: null, after: 'LEAD_ASSESSOR' },
      resultType: { before: null, after: 'all' },
    });
  });

  it('an unchanged grant keeps its id and is neither revoked nor granted again; only the difference is written', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [
        ['ASSESSOR', 'KP'],
        ['ASSESSOR', 'POLICY'],
      ],
    });
    const idOf = (key: string) =>
      w.db.assignments.find(
        (a) => a.userId === target.id && a.resultTypeKey === key,
      )!.id;
    const [keptId, droppedId] = [idOf('KP'), idOf('POLICY')];
    w.calls.length = 0;

    await w.service.replaceRoles(ctx, target.id, [
      { role: 'ASSESSOR', resultTypes: ['KP', 'INNOVATION_DEV'] },
      { role: 'TPB' },
    ]);

    const kept = w.db.assignments.find((a) => a.id === keptId)!;
    expect(kept).toMatchObject({
      isActive: true,
      revokedAt: null,
      revokedBy: null,
    });
    const dropped = w.db.assignments.find((a) => a.id === droppedId)!;
    expect(dropped).toMatchObject({ isActive: false, revokedBy: admin.id });
    expect(dropped.revokedAt).toBeInstanceOf(Date);
    expect(activeGrants(w, target.id)).toEqual([
      'ASSESSOR:INNOVATION_DEV',
      'ASSESSOR:KP',
      'TPB:',
    ]);
    expect(w.calls.filter((c) => /^(revoke|grant):/.test(c))).toEqual([
      `revoke:${droppedId}`,
      'grant:ASSESSOR:INNOVATION_DEV',
      'grant:TPB:',
    ]);
    expect(
      auditOf(w)
        .filter((e) => e.userId === target.id)
        .map((e) => e.action),
    ).toEqual(['role_revoke', 'role_grant', 'role_grant']);
  });

  it('saving the same roles again changes nothing: no write, no audit, no invalidation', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['ASSESSOR', 'KP']],
    });
    const before = w.snapshot();

    const result = await w.service.replaceRoles(ctx, target.id, [
      { role: 'ASSESSOR', resultTypes: ['KP'] },
    ]);

    expect(result.changed).toBe(false);
    expectUntouched(w, before);
  });

  it('swaps Assessor KP for Lead Assessor KP: the old grant is revoked before the new one is inserted, so the overlap rule does not refuse it', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['ASSESSOR', 'KP']],
    });
    const oldId = w.db.assignments.find((a) => a.userId === target.id)!.id;
    w.calls.length = 0;

    await w.service.replaceRoles(ctx, target.id, [
      { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
    ]);

    expect(activeGrants(w, target.id)).toEqual(['LEAD_ASSESSOR:KP']);
    expect(w.calls.filter((c) => /^(revoke|grant):/.test(c))).toEqual([
      `revoke:${oldId}`,
      'grant:LEAD_ASSESSOR:KP',
    ]);
  });

  it.each([
    [
      'Assessor and Lead Assessor on the same type',
      [
        { role: 'ASSESSOR', resultTypes: ['KP'] },
        { role: 'LEAD_ASSESSOR', resultTypes: ['KP', 'POLICY'] },
      ],
    ],
    [
      'Assessor on all and Lead Assessor on one type (through all)',
      [
        { role: 'ASSESSOR', resultTypes: 'all' },
        { role: 'LEAD_ASSESSOR', resultTypes: ['KP'] },
      ],
    ],
    [
      'Assessor on one type and Lead Assessor on all (through all)',
      [
        { role: 'ASSESSOR', resultTypes: ['KP'] },
        { role: 'LEAD_ASSESSOR', resultTypes: 'all' },
      ],
    ],
  ] as const)(
    '%s: 409 USERS_ROLE_CONFLICT and nothing changes',
    async (_name, roles) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({
        email: 't@cgiar.org',
        nickname: 'T',
        roles: [['TPB']],
      });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.replaceRoles(ctx, target.id, roles as never),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_ROLE_CONFLICT');
      expectUntouched(w, before);
    },
  );

  it.each([
    [
      'a role listed twice (Assessor on KP and Assessor on all has no representation)',
      [
        { role: 'ASSESSOR', resultTypes: ['KP'] },
        { role: 'ASSESSOR', resultTypes: 'all' },
      ],
      [{ field: 'roles[1].role', code: 'INVALID' }],
    ],
    [
      'the internal * inside the result types',
      [{ role: 'ASSESSOR', resultTypes: ['KP', '*'] }],
      [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
    ],
    [
      'an empty list of result types',
      [{ role: 'ASSESSOR', resultTypes: [] }],
      [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
    ],
    [
      'result types on a global role',
      [{ role: 'TPB', resultTypes: ['KP'] }],
      [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
    ],
    [
      'no result types on a scoped role',
      [{ role: 'LEAD_ASSESSOR' }],
      [{ field: 'roles[0].resultTypes', code: 'REQUIRED' }],
    ],
    [
      'a result type that is not in the catalog',
      [{ role: 'ASSESSOR', resultTypes: ['NOPE'] }],
      [{ field: 'roles[0].resultTypes', code: 'INVALID' }],
    ],
    [
      'the non-grantable PROGRAM role',
      [{ role: 'PROGRAM', resultTypes: ['KP'] }],
      [{ field: 'roles[0].role', code: 'INVALID' }],
    ],
  ] as const)(
    'rejects %s with VALIDATION_FAILED on the API field; no transaction, nothing written',
    async (_name, roles, fields) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
      const before = w.snapshot();
      w.calls.length = 0;

      const error = await failureOf(
        w.service.replaceRoles(ctx, target.id, roles as never),
      );

      expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
      expect(bodyOf(error).fields).toMatchObject(fields);
      expect(w.calls).toEqual([]);
      expectUntouched(w, before);
    },
  );

  describe('last admin (FR-7, DD-3)', () => {
    it('refuses to remove the only admin, oneself included: 409 USERS_LAST_ADMIN, and the guard ran before any insert', async () => {
      const { w, admin, ctx } = await setup();
      const before = w.snapshot();
      w.calls.length = 0;

      const error = await failureOf(
        w.service.replaceRoles(ctx, admin.id, [{ role: 'TPB' }]),
      );

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_LAST_ADMIN');
      expect(w.calls.filter((c) => c.startsWith('grant:'))).toEqual([]);
      expectUntouched(w, before);
    });

    it('lets an admin go when another admin remains, running the guard BEFORE the first revoke and the first insert', async () => {
      const { w, ctx } = await setup();
      const second = await w.seedUser({
        email: 'second@cgiar.org',
        nickname: 'Second',
        roles: [['ADMIN']],
      });
      w.calls.length = 0;

      await w.service.replaceRoles(ctx, second.id, [{ role: 'TPB' }]);

      expect(activeGrants(w, second.id)).toEqual(['TPB:']);
      const order = w.calls.filter((c) =>
        /^(guard|revoke:|grant:|tx:)/.test(c),
      );
      expect(order[0]).toBe('tx:begin');
      expect(order[1]).toBe('guard');
      expect(order.findIndex((c) => c.startsWith('revoke:'))).toBeGreaterThan(
        1,
      );
      expect(order.findIndex((c) => c.startsWith('grant:'))).toBeGreaterThan(
        order.findIndex((c) => c.startsWith('revoke:')),
      );
    });

    it('does not run the guard when no ADMIN grant is revoked', async () => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });

      await w.service.replaceRoles(ctx, target.id, [{ role: 'TPB' }]);

      expect(w.calls).not.toContain('guard');
    });

    it('holds when two admins remove each other at the same time: exactly one succeeds, one admin remains', async () => {
      const { w, admin } = await setup();
      const second = await w.seedUser({
        email: 'second@cgiar.org',
        nickname: 'Second',
        roles: [['ADMIN']],
      });

      const settled = await Promise.allSettled([
        w.service.replaceRoles(
          { actorId: admin.id, requestId: 'a' },
          second.id,
          [{ role: 'TPB' }],
        ),
        w.service.replaceRoles(
          { actorId: second.id, requestId: 'b' },
          admin.id,
          [{ role: 'TPB' }],
        ),
      ]);

      expect(
        settled.map((s) => s.status).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['fulfilled', 'rejected']);
      const refused = settled.find(
        (s) => s.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(bodyOf(refused.reason as HttpException).code).toBe(
        'USERS_LAST_ADMIN',
      );
      const admins = w.db.assignments.filter(
        (a) =>
          a.isActive &&
          a.roleId === w.db.roles.find((r) => r.code === 'ADMIN')!.id,
      );
      expect(admins).toHaveLength(1);
    });
  });

  it('invalidates the target only after the commit', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    w.calls.length = 0;

    await w.service.replaceRoles(ctx, target.id, [{ role: 'TPB' }]);

    expect(w.cache.invalidate).toHaveBeenCalledExactlyOnceWith(target.id);
    expect(w.calls.at(-2)).toBe('tx:commit');
    expect(w.calls.at(-1)).toBe(`invalidate:${target.id}`);
  });
});

describe('UsersAdminService.replacePrograms (FR-4)', () => {
  it('sets, changes and clears the scope by diff, auditing before and after each time', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    const scopeOf = () =>
      w.db.scope.filter((s) => s.userId === target.id).map((s) => s.programId);

    await w.service.replacePrograms(ctx, target.id, [2, 1]);
    expect(scopeOf()).toEqual([1, 2]);
    await w.service.replacePrograms(ctx, target.id, [2, 3]);
    expect(scopeOf().sort((a, b) => a - b)).toEqual([2, 3]);
    await w.service.replacePrograms(ctx, target.id, 'all');
    expect(scopeOf()).toEqual([]);

    expect(
      auditOf(w)
        .filter((e) => e.userId === target.id)
        .map((e) => [e.action, e.changes]),
    ).toEqual([
      ['scope_change', { programs: { before: 'all', after: [1, 2] } }],
      ['scope_change', { programs: { before: [1, 2], after: [2, 3] } }],
      ['scope_change', { programs: { before: [2, 3], after: 'all' } }],
    ]);
    expect(w.cache.invalidate).toHaveBeenCalledTimes(3);
  });

  it('writes nothing when the scope is already what was asked', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await w.service.replacePrograms(ctx, target.id, [1]);
    const before = w.snapshot();
    w.cache.invalidate.mockClear();

    const result = await w.service.replacePrograms(ctx, target.id, [1]);

    expect(result.changed).toBe(false);
    expectUntouched(w, before);
  });

  it.each([
    ['an unknown program', [1, 99]],
    ['an empty list (it would silently mean all)', []],
    ['a non-integer id', [1.5]],
  ] as const)(
    'rejects %s with VALIDATION_FAILED on `programs`; nothing written',
    async (_name, programs) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.replacePrograms(ctx, target.id, [...programs]),
      );

      expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
      expect(bodyOf(error).fields).toMatchObject([
        { field: 'programs', code: 'INVALID' },
      ]);
      expectUntouched(w, before);
    },
  );
});

describe('exclusions (FR-4, DD-12)', () => {
  const reportingExclusion = (
    w: AdminWorld,
    userId: number,
    programId: number,
  ) =>
    w.db.stores.programs.insertExclusion({
      userId,
      programId,
      origin: 'reporting',
      reportingRole: 'Lead',
      createdBy: null,
    });

  it('blocks a program even when it is in the scope: a manual row with who, when and why, one audit event', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await w.service.replacePrograms(ctx, target.id, [1, 2]);

    await w.service.addExclusion(ctx, target.id, {
      programId: 1,
      reason: '  Co-authored the results  ',
    });

    expect(w.db.exclusions).toMatchObject([
      {
        userId: target.id,
        programId: 1,
        origin: 'manual',
        status: 'active',
        reason: 'Co-authored the results',
        createdBy: admin.id,
      },
    ]);
    expect(w.db.exclusions[0]!.createdAt).toBeInstanceOf(Date);
    expect(auditOf(w).at(-1)).toEqual({
      action: 'exclusion_add',
      userId: target.id,
      actorId: admin.id,
      requestId: 'req-1',
      changes: {
        exclusionId: { before: null, after: w.db.exclusions[0]!.id },
        programId: { before: null, after: 1 },
        origin: { before: null, after: 'manual' },
        reason: { before: null, after: 'Co-authored the results' },
      },
    });
    expect(w.cache.invalidate).toHaveBeenCalledWith(target.id);
  });

  it('refuses a second active exclusion of the same program: 409 USERS_EXCLUSION_EXISTS, nothing written', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await w.service.addExclusion(ctx, target.id, { programId: 1, reason: 'r' });
    const before = w.snapshot();
    w.cache.invalidate.mockClear();

    const error = await failureOf(
      w.service.addExclusion(ctx, target.id, { programId: 1, reason: 'again' }),
    );

    expect(bodyOf(error).code).toBe('USERS_EXCLUSION_EXISTS');
    expectUntouched(w, before);
  });

  it.each([
    [
      'an unknown program',
      { programId: 99, reason: 'r' },
      [{ field: 'programId', code: 'INVALID' }],
    ],
    [
      'a missing reason',
      { programId: 1, reason: '   ' },
      [{ field: 'reason', code: 'REQUIRED' }],
    ],
    [
      'a reason over 500 characters',
      { programId: 1, reason: 'r'.repeat(501) },
      [{ field: 'reason', code: 'TOO_LONG' }],
    ],
  ] as const)(
    'rejects %s with VALIDATION_FAILED on the API field',
    async (_name, exclusion, fields) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
      const before = w.snapshot();

      const error = await failureOf(
        w.service.addExclusion(ctx, target.id, { ...exclusion }),
      );

      expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
      expect(bodyOf(error).fields).toMatchObject(fields);
      expectUntouched(w, before);
    },
  );

  it('removes a manual exclusion: no longer active, history kept, and the acting admin is ended_by', async () => {
    const { w, ctx } = await setup();
    const other = await w.seedUser({
      email: 'other.admin@cgiar.org',
      nickname: 'Other',
      roles: [['ADMIN']],
    });
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await w.service.addExclusion(ctx, target.id, { programId: 2, reason: 'r' });
    const exclusionId = w.db.exclusions[0]!.id;

    await w.service.removeExclusion(
      { actorId: other.id, requestId: 'req-9' },
      target.id,
      exclusionId,
    );

    expect(w.db.exclusions[0]).toMatchObject({
      id: exclusionId,
      status: 'removed',
      endedBy: other.id,
      activeKey: null,
    });
    expect(w.db.exclusions[0]!.endedAt).toBeInstanceOf(Date);
    expect(auditOf(w).at(-1)).toMatchObject({
      action: 'exclusion_remove',
      userId: target.id,
      actorId: other.id,
      requestId: 'req-9',
      changes: {
        exclusion: {
          before: { id: exclusionId, programId: 2, status: 'active' },
          after: { id: exclusionId, programId: 2, status: 'removed' },
        },
      },
    });
  });

  it('refuses to remove a Reporting exclusion (409 USERS_EXCLUSION_NOT_MANUAL) or an ended or unknown one (404), writing nothing', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await reportingExclusion(w, target.id, 1);
    await w.service.addExclusion(ctx, target.id, { programId: 2, reason: 'r' });
    const [reporting, manual] = w.db.exclusions;
    await w.service.removeExclusion(ctx, target.id, manual!.id);
    const before = w.snapshot();
    w.cache.invalidate.mockClear();

    const notManual = await failureOf(
      w.service.removeExclusion(ctx, target.id, reporting!.id),
    );
    const ended = await failureOf(
      w.service.removeExclusion(ctx, target.id, manual!.id),
    );
    const unknown = await failureOf(
      w.service.removeExclusion(ctx, target.id, 9999),
    );

    expect([notManual.getStatus(), bodyOf(notManual).code]).toEqual([
      409,
      'USERS_EXCLUSION_NOT_MANUAL',
    ]);
    expect([ended.getStatus(), bodyOf(ended).code]).toEqual([
      404,
      'USERS_EXCLUSION_NOT_FOUND',
    ]);
    expect(bodyOf(unknown).code).toBe('USERS_EXCLUSION_NOT_FOUND');
    expectUntouched(w, before);
  });

  it('dismisses a Reporting exclusion with a reason: it stops excluding, who, when and why are kept, the acting admin is ended_by', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await reportingExclusion(w, target.id, 3);
    const exclusionId = w.db.exclusions[0]!.id;

    await w.service.dismissExclusion(
      ctx,
      target.id,
      exclusionId,
      '  Checked with the program lead  ',
    );

    expect(w.db.exclusions[0]).toMatchObject({
      status: 'dismissed',
      endedBy: admin.id,
      endReason: 'Checked with the program lead',
      activeKey: null,
    });
    expect(w.db.exclusions[0]!.endedAt).toBeInstanceOf(Date);
    expect(auditOf(w).at(-1)).toMatchObject({
      action: 'exclusion_dismiss',
      userId: target.id,
      actorId: admin.id,
      changes: {
        exclusion: {
          before: { id: exclusionId, programId: 3, status: 'active' },
          after: {
            id: exclusionId,
            programId: 3,
            status: 'dismissed',
            endReason: 'Checked with the program lead',
          },
        },
      },
    });
    expect(w.cache.invalidate).toHaveBeenCalledWith(target.id);
  });

  it('requires a reason to dismiss: 400 on `reason`, the exclusion stays active, nothing written', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await reportingExclusion(w, target.id, 3);
    const before = w.snapshot();

    const error = await failureOf(
      w.service.dismissExclusion(ctx, target.id, w.db.exclusions[0]!.id, '  '),
    );

    expect(bodyOf(error).code).toBe('VALIDATION_FAILED');
    expect(bodyOf(error).fields).toMatchObject([
      { field: 'reason', code: 'REQUIRED' },
    ]);
    expect(w.db.exclusions[0]!.status).toBe('active');
    expectUntouched(w, before);
  });

  it('refuses to dismiss a manual exclusion: 409 USERS_EXCLUSION_NOT_REPORTING', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 't@cgiar.org', nickname: 'T' });
    await w.service.addExclusion(ctx, target.id, { programId: 1, reason: 'r' });
    const before = w.snapshot();
    w.cache.invalidate.mockClear();

    const error = await failureOf(
      w.service.dismissExclusion(ctx, target.id, w.db.exclusions[0]!.id, 'why'),
    );

    expect(bodyOf(error).code).toBe('USERS_EXCLUSION_NOT_REPORTING');
    expectUntouched(w, before);
  });
});

describe('deactivate and reactivate (FR-7)', () => {
  it('deactivates in QA only: audited, invalidated, and Cognito is never called', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      roles: [['TPB']],
    });

    const result = await w.service.deactivate(ctx, target.id);

    expect(result).toEqual({ userId: target.id, changed: true });
    expect(rowOf(w, 't@cgiar.org')!.isActive).toBe(false);
    expect(auditOf(w).at(-1)).toEqual({
      action: 'deactivate',
      userId: target.id,
      actorId: admin.id,
      requestId: 'req-1',
      changes: { isActive: { before: true, after: false } },
    });
    expect(w.cache.invalidate).toHaveBeenCalledWith(target.id);
    expect(w.cognito.getUser).not.toHaveBeenCalled();
    expect(w.cognito.createUser).not.toHaveBeenCalled();
    expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
    expect(w.calls).not.toContain('guard');
  });

  it('reactivates, audited as reactivate; asking for what already holds writes nothing', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 't@cgiar.org',
      nickname: 'T',
      isActive: false,
    });

    await w.service.activate(ctx, target.id);
    expect(rowOf(w, 't@cgiar.org')!.isActive).toBe(true);
    expect(auditOf(w).at(-1)).toEqual({
      action: 'reactivate',
      userId: target.id,
      actorId: admin.id,
      requestId: 'req-1',
      changes: { isActive: { before: false, after: true } },
    });

    const before = w.snapshot();
    w.cache.invalidate.mockClear();
    const again = await w.service.activate(ctx, target.id);
    expect(again.changed).toBe(false);
    expectUntouched(w, before);
  });

  it('a deactivated user cannot log in (403 AUTH_USER_INACTIVE) and their session refresh is refused', async () => {
    const { w, ctx } = await setup();
    const { userId } = await w.service.create(ctx, command());
    const admission = admissionOf(w, {
      sub: 'sso-sub-1',
      email: 'new.user@cgiar.org',
      identities: [{ providerName: 'CGIAR-AzureAD' }],
    });
    await expect(
      admission.resolve('t', { mode: 'login' }),
    ).resolves.toBeDefined();

    await w.service.deactivate(ctx, userId);

    const login = await failureOf(admission.resolve('t', { mode: 'login' }));
    const refresh = await failureOf(
      admission.resolve('t', { mode: 'refresh' }),
    );
    expect(login).toBeInstanceOf(UserInactiveError);
    expect(login.getStatus()).toBe(403);
    expect(bodyOf(login).code).toBe('AUTH_USER_INACTIVE');
    expect(refresh).toBeInstanceOf(UserInactiveError);
    expect(w.cognito.getUser).not.toHaveBeenCalled();
    expect(w.cognito.createUser).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the only admin, oneself included: 409 USERS_LAST_ADMIN, nothing changes', async () => {
    const { w, admin, ctx } = await setup();
    const before = w.snapshot();

    const error = await failureOf(w.service.deactivate(ctx, admin.id));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error).code).toBe('USERS_LAST_ADMIN');
    expectUntouched(w, before);
  });

  it('holds when two admins deactivate each other at the same time: one succeeds, one is refused, one active admin remains', async () => {
    const { w, admin } = await setup();
    const second = await w.seedUser({
      email: 'second@cgiar.org',
      nickname: 'Second',
      roles: [['ADMIN']],
    });

    const settled = await Promise.allSettled([
      w.service.deactivate({ actorId: admin.id, requestId: 'a' }, second.id),
      w.service.deactivate({ actorId: second.id, requestId: 'b' }, admin.id),
    ]);

    expect(
      settled.map((s) => s.status).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['fulfilled', 'rejected']);
    expect(w.db.users.filter((u) => u.isActive).map((u) => u.id)).toHaveLength(
      1,
    );
    expect(w.db.audit.filter((e) => e.action === 'deactivate')).toHaveLength(1);
  });
});

describe('resendInvitation (FR-8)', () => {
  it('resends to a custom user who never signed in: Cognito before the transaction, the new send date audited', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 'inv@cgiar.org',
      nickname: 'Inv',
      invitation: 'sent',
    });
    w.calls.length = 0;

    const result = await w.service.resendInvitation(ctx, target.id);

    expect(result).toEqual({ userId: target.id, changed: true });
    expect(w.cognito.resendInvitation).toHaveBeenCalledExactlyOnceWith(
      'inv@cgiar.org',
    );
    expect(w.calls.slice(0, 3)).toEqual([
      'cognito:resend',
      'tx:begin',
      'tx:commit',
    ]);
    const row = rowOf(w, 'inv@cgiar.org')!;
    expect(row.invitedAt).toBeInstanceOf(Date);
    expect(auditOf(w).at(-1)).toMatchObject({
      action: 'invitation_resend',
      userId: target.id,
      actorId: admin.id,
      changes: { invitedAt: { before: null } },
    });
    expect(w.cache.invalidate).toHaveBeenCalledWith(target.id);
  });

  it.each([
    ['an SSO user', { authSource: 'sso', invitation: 'none' }],
    [
      'a user who has signed in',
      { invitation: 'sent', lastLoginAt: new Date('2026-10-02T09:00:00Z') },
    ],
    [
      'an account that pre-existed in the pool',
      { invitation: 'existing_account' },
    ],
    ['a user who was never invited', { invitation: 'none' }],
    ['a deactivated user (DD-15)', { invitation: 'sent', isActive: false }],
  ] as const)(
    '%s: 409 USERS_INVITATION_NOT_APPLICABLE, Cognito not called, no audit',
    async (_name, seed) => {
      const { w, ctx } = await setup();
      const target = await w.seedUser({
        email: 'inv@cgiar.org',
        nickname: 'Inv',
        ...seed,
      });
      const before = w.snapshot();

      const error = await failureOf(w.service.resendInvitation(ctx, target.id));

      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error).code).toBe('USERS_INVITATION_NOT_APPLICABLE');
      expect(w.cognito.resendInvitation).not.toHaveBeenCalled();
      expectUntouched(w, before);
    },
  );

  it('Cognito saying not_applicable (confirmed, or gone from the pool): 409 and nothing written', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'inv@cgiar.org',
      nickname: 'Inv',
      invitation: 'sent',
    });
    w.cognito.resendInvitation.mockResolvedValueOnce('not_applicable');
    const before = w.snapshot();

    const error = await failureOf(w.service.resendInvitation(ctx, target.id));

    expect(bodyOf(error).code).toBe('USERS_INVITATION_NOT_APPLICABLE');
    expect(w.cognito.resendInvitation).toHaveBeenCalledTimes(1);
    expectUntouched(w, before);
  });

  it('Cognito unavailable: 503 AUTH_SERVICE_UNAVAILABLE and nothing written', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'inv@cgiar.org',
      nickname: 'Inv',
      invitation: 'sent',
    });
    w.cognito.resendInvitation.mockRejectedValueOnce(
      new UpstreamUnavailableError(),
    );
    const before = w.snapshot();

    const error = await failureOf(w.service.resendInvitation(ctx, target.id));

    expect(error.getStatus()).toBe(503);
    expect(bodyOf(error).code).toBe('AUTH_SERVICE_UNAVAILABLE');
    expectUntouched(w, before);
  });
});

describe('uniqueness races use plain reads (DD-15)', () => {
  const forUpdate = (w: AdminWorld) =>
    w.calls.filter((c) => c.endsWith(':for-update'));

  it('edit looks the nickname up with a plain read: only the target row is locked', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 'b@cgiar.org', nickname: 'Beta' });
    w.calls.length = 0;

    await w.service.edit(ctx, target.id, { nickname: 'Gamma' });

    expect(w.calls).toContain('lookup:nickname:plain');
    expect(forUpdate(w)).toEqual([]);
  });

  it('a nickname committed by another transaction after the lookup is caught by the unique index: 409, no audit, no invalidation', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({ email: 'b@cgiar.org', nickname: 'Beta' });
    w.unitOfWork.beforeUserWrite = async () => {
      w.unitOfWork.beforeUserWrite = undefined;
      await w.db.stores.users.insert({
        email: 'racer@cgiar.org',
        nickname: 'Gamma',
      });
    };

    const error = await failureOf(
      w.service.edit(ctx, target.id, { nickname: 'Gamma' }),
    );

    expect(bodyOf(error).code).toBe('USERS_NICKNAME_TAKEN');
    expect(w.db.audit.filter((e) => e.action === 'update')).toEqual([]);
    expect(w.cache.invalidate).not.toHaveBeenCalled();
    expect(rowOf(w, 'b@cgiar.org')!.nickname).toBe('Beta');
  });

  it('create resolves a lost email race with a plain read, 409 USERS_EMAIL_TAKEN, nothing recorded', async () => {
    const { w, ctx } = await setup();
    w.unitOfWork.beforeUserWrite = async () => {
      w.unitOfWork.beforeUserWrite = undefined;
      await w.db.stores.users.insert({
        email: 'new.user@cgiar.org',
        nickname: 'Racer',
      });
    };

    const error = await failureOf(w.service.create(ctx, command()));

    expect(bodyOf(error).code).toBe('USERS_EMAIL_TAKEN');
    expect(forUpdate(w)).toEqual([]);
    expect(w.db.audit.filter((e) => e.action === 'create')).toEqual([]);
    expect(w.cache.invalidate).not.toHaveBeenCalled();
  });

  it('create resolves a lost nickname race with a plain read, 409 USERS_NICKNAME_TAKEN', async () => {
    const { w, ctx } = await setup();
    w.unitOfWork.beforeUserWrite = async () => {
      w.unitOfWork.beforeUserWrite = undefined;
      await w.db.stores.users.insert({
        email: 'racer@cgiar.org',
        nickname: 'nia o',
      });
    };

    const error = await failureOf(w.service.create(ctx, command()));

    expect(bodyOf(error).code).toBe('USERS_NICKNAME_TAKEN');
    expect(forUpdate(w)).toEqual([]);
    expect(rowOf(w, 'new.user@cgiar.org')).toBeUndefined();
  });
});

describe('Cognito resent but QA could not record it', () => {
  const sentNotRecorded = () =>
    logged
      .filter((line) => line.includes('cognito_sent_not_recorded'))
      .map((line) => JSON.parse(line));

  it('logs outcome=error reason=cognito_sent_not_recorded when the in-transaction re-check refuses (the user signed in meanwhile)', async () => {
    const { w, admin, ctx } = await setup();
    const target = await w.seedUser({
      email: 'inv@cgiar.org',
      nickname: 'Inv',
      invitation: 'sent',
    });
    w.cognito.resendInvitation.mockImplementationOnce(async () => {
      await w.users.update(target.id, { lastLoginAt: new Date() });
      return 'resent';
    });

    const error = await failureOf(w.service.resendInvitation(ctx, target.id));

    expect(bodyOf(error).code).toBe('USERS_INVITATION_NOT_APPLICABLE');
    expect(sentNotRecorded()).toEqual([
      {
        event: 'users_admin',
        action: 'invitation_resend',
        targetId: target.id,
        actorId: admin.id,
        outcome: 'error',
        reason: 'cognito_sent_not_recorded',
        requestId: 'req-1',
      },
    ]);
    expect(w.db.audit.filter((e) => e.action === 'invitation_resend')).toEqual(
      [],
    );
  });

  it('logs it when the write fails; and never when Cognito itself refuses', async () => {
    const { w, ctx } = await setup();
    const target = await w.seedUser({
      email: 'inv@cgiar.org',
      nickname: 'Inv',
      invitation: 'sent',
    });
    w.unitOfWork.beforeUserWrite = async () => {
      throw new Error('connection lost');
    };
    await failureOf(w.service.resendInvitation(ctx, target.id));
    expect(sentNotRecorded()).toHaveLength(1);

    w.unitOfWork.beforeUserWrite = undefined;
    logged.length = 0;
    w.cognito.resendInvitation.mockResolvedValueOnce('not_applicable');
    await failureOf(w.service.resendInvitation(ctx, target.id));
    expect(sentNotRecorded()).toEqual([]);
  });
});

describe('decision log (NFR-2)', () => {
  it('writes one users_admin line per mutation, ok or refused, with ids only: never an email, a name or a nickname', async () => {
    const { w, admin, ctx } = await setup();

    const { userId } = await w.service.create(ctx, command());
    await failureOf(w.service.create(ctx, command()));
    w.cognito.getUser.mockRejectedValueOnce(new UpstreamUnavailableError());
    await failureOf(
      w.service.create(
        ctx,
        command({
          accountType: 'custom',
          email: 'other@cgiar.org',
          nickname: 'Oth',
        }),
      ),
    );
    await w.service.deactivate(ctx, userId);

    const mine = logged.filter((line) => line.includes('users_admin'));
    expect(mine.map((line) => JSON.parse(line))).toEqual([
      {
        event: 'users_admin',
        action: 'create',
        targetId: userId,
        actorId: admin.id,
        outcome: 'ok',
        requestId: 'req-1',
      },
      {
        event: 'users_admin',
        action: 'create',
        targetId: null,
        actorId: admin.id,
        outcome: 'refused',
        reason: 'USERS_EMAIL_TAKEN',
        requestId: 'req-1',
      },
      {
        event: 'users_admin',
        action: 'create',
        targetId: null,
        actorId: admin.id,
        outcome: 'error',
        reason: 'AUTH_SERVICE_UNAVAILABLE',
        requestId: 'req-1',
      },
      {
        event: 'users_admin',
        action: 'deactivate',
        targetId: userId,
        actorId: admin.id,
        outcome: 'ok',
        requestId: 'req-1',
      },
    ]);
    const everything = logged.join('\n').toLowerCase();
    for (const secret of ['new.user', 'other@', 'nia', 'okoro', 'oth']) {
      expect(everything).not.toContain(secret);
    }
  });
});
