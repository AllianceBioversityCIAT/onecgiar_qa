import { Logger } from '@nestjs/common';
import type { User } from '../database/drizzle/schema/users.js';
import type { UsersRepository } from '../users/users.repository.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import type { CognitoAdminClient } from './cognito-admin.client.js';
import {
  type CognitoAuthClient,
  UpstreamUnavailableError,
} from './cognito-auth.client.js';

const user = (over: Partial<User> = {}) =>
  ({
    id: 7,
    email: 'ada@example.org',
    authSource: 'custom',
    isActive: true,
    ...over,
  }) as User;

function world(found: User | null = user()) {
  const auth = { forgotPassword: vi.fn() };
  const admin = {
    getUser: vi.fn(async () => ({ status: 'FORCE_CHANGE_PASSWORD' })),
    resendInvitation: vi.fn(async () => 'resent' as const),
  };
  const users = { findByEmail: vi.fn(async () => found ?? undefined) };
  const service = new AccountRecoveryService(
    auth as unknown as CognitoAuthClient,
    admin as unknown as CognitoAdminClient,
    users as unknown as UsersRepository,
  );
  return { auth, admin, users, service };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('AccountRecoveryService.forgotPassword', () => {
  it('Cognito sent the code: nothing else happens', async () => {
    const w = world();
    w.auth.forgotPassword.mockResolvedValueOnce({ kind: 'sent' });

    await expect(w.service.forgotPassword('ada@example.org')).resolves.toBe(
      'code_sent',
    );
    expect(w.users.findByEmail).not.toHaveBeenCalled();
  });

  it('refused for an active custom QA user who never set a password: a new temporary password', async () => {
    const w = world();
    w.auth.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'NotAuthorizedException',
    });

    await expect(w.service.forgotPassword('ada@example.org')).resolves.toBe(
      'invitation_resent',
    );
    expect(w.admin.resendInvitation).toHaveBeenCalledExactlyOnceWith(
      'ada@example.org',
    );
  });

  it.each([
    ['unknown to QA', null],
    ['deactivated', user({ isActive: false })],
    ['SSO', user({ authSource: 'sso' })],
  ])('refused, %s: nothing sent', async (_name, found) => {
    const w = world(found);
    w.auth.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'UserNotFoundException',
    });

    await expect(w.service.forgotPassword('ada@example.org')).resolves.toBe(
      'not_applicable',
    );
    expect(w.admin.resendInvitation).not.toHaveBeenCalled();
  });

  it('refused, account already has a password (or none in the pool): nothing sent', async () => {
    const w = world();
    w.auth.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'NotAuthorizedException',
    });
    w.admin.getUser.mockResolvedValueOnce({ status: 'CONFIRMED' });

    await expect(w.service.forgotPassword('ada@example.org')).resolves.toBe(
      'not_applicable',
    );
    expect(w.admin.resendInvitation).not.toHaveBeenCalled();
  });

  it('the fallback failing never changes the answer', async () => {
    const w = world();
    w.auth.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'NotAuthorizedException',
    });
    w.admin.getUser.mockRejectedValueOnce(new UpstreamUnavailableError());

    await expect(w.service.forgotPassword('ada@example.org')).resolves.toBe(
      'not_applicable',
    );
  });

  it('ForgotPassword itself unavailable: 503 propagates', async () => {
    const w = world();
    w.auth.forgotPassword.mockRejectedValueOnce(new UpstreamUnavailableError());

    await expect(
      w.service.forgotPassword('ada@example.org'),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});
