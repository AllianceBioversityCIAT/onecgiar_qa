import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { CognitoAdminClient } from '../src/auth/cognito-admin.client.js';
import {
  CognitoAuthClient,
  PasswordPolicyError,
  ResetCodeInvalidError,
  UpstreamUnavailableError,
} from '../src/auth/cognito-auth.client.js';
import { configureApp } from '../src/common/configure-app.js';
import { ROLE_ASSIGNMENTS_STORE } from '../src/users/role-assignments.repository.js';
import { USER_PROGRAMS_STORE } from '../src/users/user-programs.repository.js';
import { USERS_STORE, UsersRepository } from '../src/users/users.repository.js';
import {
  InMemoryRoleAssignmentsStore,
  InMemoryUserProgramsStore,
  InMemoryUsersStore,
} from './support/in-memory-stores.js';

// Self-service password recovery over the real app (Cognito faked):
// POST /auth/forgot-password and POST /auth/reset-password.

const NEW_PASSWORD = 'N3w-P@ssw0rd-SECRET';
const CODE = '123456';

const client = {
  loginCustom: vi.fn(),
  completeNewPassword: vi.fn(),
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
};
const admin = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  resendInvitation: vi.fn(),
};

let app: NestExpressApplication;
let users: UsersRepository;
let logged: string[];

beforeEach(async () => {
  vi.resetAllMocks();
  logged = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
  }
  const usersStore = new InMemoryUsersStore();
  users = new UsersRepository(usersStore);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CognitoAuthClient)
    .useValue(client)
    .overrideProvider(CognitoAdminClient)
    .useValue(admin)
    .overrideProvider(USERS_STORE)
    .useValue(usersStore)
    .overrideProvider(ROLE_ASSIGNMENTS_STORE)
    .useValue(new InMemoryRoleAssignmentsStore())
    .overrideProvider(USER_PROGRAMS_STORE)
    .useValue(new InMemoryUserProgramsStore())
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

const post = (path: string, body: object) =>
  request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(body);

describe('POST /auth/forgot-password', () => {
  it('202 with the same body whether Cognito sent a code or refused (no enumeration)', async () => {
    client.forgotPassword.mockResolvedValueOnce({ kind: 'sent' });
    const sent = await post('forgot-password', { email: 'ada@example.org' });

    client.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'UserNotFoundException',
    });
    const unknown = await post('forgot-password', {
      email: 'nobody@example.org',
    });

    expect(sent.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(sent.body.data).toEqual({ accepted: true });
    expect(unknown.body.data).toEqual(sent.body.data);
  });

  it('an active custom QA user who never set a password gets a new temporary password', async () => {
    await users.create({
      email: 'new@example.org',
      authSource: 'custom',
      invitation: 'sent',
    });
    client.forgotPassword.mockResolvedValueOnce({
      kind: 'refused',
      upstreamType: 'NotAuthorizedException',
    });
    admin.getUser.mockResolvedValueOnce({ status: 'FORCE_CHANGE_PASSWORD' });
    admin.resendInvitation.mockResolvedValueOnce('resent');

    const res = await post('forgot-password', { email: 'new@example.org' });

    expect(res.status).toBe(202);
    expect(admin.resendInvitation).toHaveBeenCalledExactlyOnceWith(
      'new@example.org',
    );
  });

  it('400 on a malformed email, before Cognito', async () => {
    const res = await post('forgot-password', { email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(client.forgotPassword).not.toHaveBeenCalled();
  });

  it('503 when Cognito is down', async () => {
    client.forgotPassword.mockRejectedValueOnce(new UpstreamUnavailableError());
    const res = await post('forgot-password', { email: 'ada@example.org' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTH_SERVICE_UNAVAILABLE');
  });
});

describe('POST /auth/reset-password', () => {
  it('204 and no body when Cognito takes the code and the new password', async () => {
    client.confirmForgotPassword.mockResolvedValueOnce(undefined);

    const res = await post('reset-password', {
      email: 'ada@example.org',
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(204);
    expect(client.confirmForgotPassword).toHaveBeenCalledExactlyOnceWith(
      'ada@example.org',
      CODE,
      NEW_PASSWORD,
    );
    expect(logged.join('\n')).not.toContain(NEW_PASSWORD);
    expect(logged.join('\n')).not.toContain(CODE);
  });

  it.each([
    [new ResetCodeInvalidError(), 'AUTH_RESET_CODE_INVALID'],
    [new PasswordPolicyError(), 'AUTH_PASSWORD_POLICY'],
  ])('maps %s to 400 %s', async (error, code) => {
    client.confirmForgotPassword.mockRejectedValueOnce(error);

    const res = await post('reset-password', {
      email: 'ada@example.org',
      code: CODE,
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('400 on a missing code, before Cognito', async () => {
    const res = await post('reset-password', {
      email: 'ada@example.org',
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(client.confirmForgotPassword).not.toHaveBeenCalled();
  });
});

describe('leading and trailing spaces (pasted credentials)', () => {
  it('login: email and password reach Cognito trimmed', async () => {
    client.loginCustom.mockResolvedValueOnce({
      kind: 'challenge',
      challengeName: 'NEW_PASSWORD_REQUIRED',
      session: 'sess',
    });

    const res = await post('login', {
      email: '  ada@example.org ',
      password: ` ${NEW_PASSWORD}\t`,
    });

    expect(res.status).toBe(200);
    expect(client.loginCustom).toHaveBeenCalledExactlyOnceWith(
      'ada@example.org',
      NEW_PASSWORD,
    );
  });

  it('reset: email, code and new password reach Cognito trimmed', async () => {
    client.confirmForgotPassword.mockResolvedValueOnce(undefined);

    const res = await post('reset-password', {
      email: ' ada@example.org',
      code: ` ${CODE} `,
      newPassword: `${NEW_PASSWORD} `,
    });

    expect(res.status).toBe(204);
    expect(client.confirmForgotPassword).toHaveBeenCalledExactlyOnceWith(
      'ada@example.org',
      CODE,
      NEW_PASSWORD,
    );
  });

  it('a password of spaces only is empty: 400 before Cognito', async () => {
    const res = await post('login', {
      email: 'ada@example.org',
      password: '   ',
    });
    expect(res.status).toBe(400);
    expect(client.loginCustom).not.toHaveBeenCalled();
  });
});
