import { Logger } from '@nestjs/common';
import {
  AccessDeniedException,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  InternalErrorException,
  NotAuthorizedException,
  TooManyRequestsException,
  UnsupportedUserStateException,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { UpstreamUnavailableError } from './cognito-auth.client.js';
import {
  COGNITO_ADMIN_TIMEOUT_MS,
  CognitoAdminClient,
  type CognitoIdpSender,
} from './cognito-admin.client.js';

// Fixtures are the SDK's own exception classes (the shapes the client really
// receives), built with the SDK constructors: name, $fault and $metadata.

const EMAIL = 'ana.perez@example.org';
const POOL_ID = 'us-east-1_testpool';
const KEY_ID = 'AKIATESTKEYID123456';
const SECRET = 'wJalrTESTSECRETKEYvalue';
const GIVEN = 'Ana';
const FAMILY = 'Perez Gomez';

const config = {
  region: 'us-east-1',
  userPoolId: POOL_ID,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
};

const meta = (httpStatusCode: number) => ({ $metadata: { httpStatusCode } });
const usernameExists = () =>
  new UsernameExistsException({ message: `exists ${EMAIL}`, ...meta(400) });
const userNotFound = () =>
  new UserNotFoundException({ message: `no ${EMAIL}`, ...meta(400) });
const unsupportedState = () =>
  new UnsupportedUserStateException({
    message: `CONFIRMED ${EMAIL}`,
    ...meta(400),
  });
const throttled = () =>
  new TooManyRequestsException({ message: 'Rate exceeded', ...meta(400) });
const internal = () =>
  new InternalErrorException({ message: 'boom', ...meta(500) });
const accessDenied = () =>
  new AccessDeniedException({
    message: `User ${KEY_ID} is not authorized to perform: cognito-idp:AdminGetUser`,
    ...meta(400),
  });
const notAuthorized = () =>
  new NotAuthorizedException({
    message: `not authorized ${KEY_ID}`,
    ...meta(400),
  });

let send: Mock<CognitoIdpSender['send']>;
let client: CognitoAdminClient;
let logs: ReturnType<typeof vi.spyOn>[];

const loggedText = () => JSON.stringify(logs.flatMap((spy) => spy.mock.calls));

const commandOf = (call: number) => send.mock.calls[call][0];

beforeEach(() => {
  send = vi.fn<CognitoIdpSender['send']>();
  client = new CognitoAdminClient(config, { send });
  logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CognitoAdminClient.createUser', () => {
  const input = { email: EMAIL, givenName: GIVEN, familyName: FAMILY };

  it('creates the account with a verified email, the names, and Cognito emailing the temporary password', async () => {
    send.mockResolvedValue({});
    await expect(client.createUser(input)).resolves.toBe('created');

    expect(send).toHaveBeenCalledTimes(1);
    const command = commandOf(0);
    expect(command).toBeInstanceOf(AdminCreateUserCommand);
    expect(command.input).toEqual({
      UserPoolId: POOL_ID,
      Username: EMAIL,
      UserAttributes: [
        { Name: 'email', Value: EMAIL },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: GIVEN },
        { Name: 'family_name', Value: FAMILY },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    });
    // Cognito sends the invitation: no SUPPRESS, no RESEND, no password of ours.
    expect(command.input).not.toHaveProperty('MessageAction');
    expect(command.input).not.toHaveProperty('TemporaryPassword');
  });

  it('reports existing_account when the pool already has the user (UsernameExistsException)', async () => {
    send.mockRejectedValue(usernameExists());
    await expect(client.createUser(input)).resolves.toBe('existing_account');
    // Nothing else is sent: the existing account is never modified.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['throttling', throttled],
    ['a 5xx', internal],
    ['a permission refusal', notAuthorized],
    ['an IAM access denial', accessDenied],
  ])('maps %s to UpstreamUnavailableError (503)', async (_label, make) => {
    send.mockRejectedValue(make());
    await expect(client.createUser(input)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('maps a network failure to UpstreamUnavailableError', async () => {
    send.mockRejectedValue(
      Object.assign(new Error(`connect ECONNREFUSED ${EMAIL}`), {
        code: 'ECONNREFUSED',
      }),
    );
    await expect(client.createUser(input)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('aborts after the timeout and answers UpstreamUnavailableError', async () => {
    vi.useFakeTimers();
    send.mockImplementation(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const result = client.createUser(input);
    const settled = expect(result).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(COGNITO_ADMIN_TIMEOUT_MS);
    await settled;
  });
});

describe('CognitoAdminClient.getUser', () => {
  it('returns null when the pool has no such user (UserNotFoundException)', async () => {
    send.mockRejectedValue(userNotFound());
    await expect(client.getUser(EMAIL)).resolves.toBeNull();
    const command = commandOf(0);
    expect(command).toBeInstanceOf(AdminGetUserCommand);
    expect(command.input).toEqual({ UserPoolId: POOL_ID, Username: EMAIL });
  });

  it('returns the account status when the user exists', async () => {
    send.mockResolvedValue({
      Username: 'abc',
      UserStatus: 'FORCE_CHANGE_PASSWORD',
      UserAttributes: [{ Name: 'email', Value: EMAIL }],
    });
    await expect(client.getUser(EMAIL)).resolves.toEqual({
      status: 'FORCE_CHANGE_PASSWORD',
    });
  });

  it.each([
    ['throttling', throttled],
    ['a 5xx', internal],
    ['a permission refusal', notAuthorized],
  ])('maps %s to UpstreamUnavailableError (503)', async (_label, make) => {
    send.mockRejectedValue(make());
    await expect(client.getUser(EMAIL)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});

describe('CognitoAdminClient.resendInvitation', () => {
  it('resends through AdminCreateUser with MessageAction RESEND', async () => {
    send.mockResolvedValue({});
    await expect(client.resendInvitation(EMAIL)).resolves.toBe('resent');
    const command = commandOf(0);
    expect(command).toBeInstanceOf(AdminCreateUserCommand);
    expect(command.input).toEqual({
      UserPoolId: POOL_ID,
      Username: EMAIL,
      MessageAction: 'RESEND',
      DesiredDeliveryMediums: ['EMAIL'],
    });
  });

  it.each([
    ['the user is already confirmed', unsupportedState],
    ['the account no longer exists', userNotFound],
  ])('refuses as not_applicable when %s', async (_label, make) => {
    send.mockRejectedValue(make());
    await expect(client.resendInvitation(EMAIL)).resolves.toBe(
      'not_applicable',
    );
  });

  it.each([
    ['throttling', throttled],
    ['a 5xx', internal],
  ])('maps %s to UpstreamUnavailableError (503)', async (_label, make) => {
    send.mockRejectedValue(make());
    await expect(client.resendInvitation(EMAIL)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});

describe('CognitoAdminClient logging (NFR-2)', () => {
  const input = { email: EMAIL, givenName: GIVEN, familyName: FAMILY };

  // Every outcome the client can produce, with what its log lines must say.
  // `getUser` found / not found emit no line today; they are driven anyway so
  // a line added there is checked for leaks as well.
  const scenarios: Array<{
    label: string;
    arrange: () => void;
    run: () => Promise<unknown>;
    expected: string[];
  }> = [
    {
      label: 'getUser found',
      arrange: () => send.mockResolvedValueOnce({ UserStatus: 'CONFIRMED' }),
      run: () => client.getUser(EMAIL),
      expected: [],
    },
    {
      label: 'getUser not found',
      arrange: () => send.mockRejectedValueOnce(userNotFound()),
      run: () => client.getUser(EMAIL),
      expected: [],
    },
    {
      label: 'getUser throttled',
      arrange: () => send.mockRejectedValueOnce(throttled()),
      run: () => client.getUser(EMAIL).catch(() => undefined),
      expected: [
        'op=AdminGetUser',
        'outcome=unavailable',
        'error=TooManyRequestsException',
      ],
    },
    {
      label: 'getUser IAM access denied',
      arrange: () => send.mockRejectedValueOnce(accessDenied()),
      run: () => client.getUser(EMAIL).catch(() => undefined),
      expected: [
        'op=AdminGetUser',
        'outcome=unavailable',
        'error=AccessDeniedException',
      ],
    },
    {
      label: 'createUser created',
      arrange: () => send.mockResolvedValueOnce({}),
      run: () => client.createUser(input),
      expected: ['op=AdminCreateUser', 'outcome=created'],
    },
    {
      label: 'createUser existing_account',
      arrange: () => send.mockRejectedValueOnce(usernameExists()),
      run: () => client.createUser(input),
      expected: ['op=AdminCreateUser', 'outcome=existing_account'],
    },
    {
      label: 'createUser upstream failure',
      arrange: () => send.mockRejectedValueOnce(notAuthorized()),
      run: () => client.createUser(input).catch(() => undefined),
      expected: [
        'op=AdminCreateUser',
        'outcome=unavailable',
        'error=NotAuthorizedException',
      ],
    },
    {
      label: 'createUser 5xx',
      arrange: () => send.mockRejectedValueOnce(internal()),
      run: () => client.createUser(input).catch(() => undefined),
      expected: ['outcome=unavailable', 'error=InternalErrorException'],
    },
    {
      label: 'resendInvitation resent',
      arrange: () => send.mockResolvedValueOnce({}),
      run: () => client.resendInvitation(EMAIL),
      expected: ['op=AdminCreateUser', 'outcome=resent'],
    },
    {
      label: 'resendInvitation not_applicable (already confirmed)',
      arrange: () => send.mockRejectedValueOnce(unsupportedState()),
      run: () => client.resendInvitation(EMAIL),
      expected: [
        'outcome=not_applicable',
        'error=UnsupportedUserStateException',
      ],
    },
    {
      label: 'resendInvitation not_applicable (account gone)',
      arrange: () => send.mockRejectedValueOnce(userNotFound()),
      run: () => client.resendInvitation(EMAIL),
      expected: ['outcome=not_applicable', 'error=UserNotFoundException'],
    },
    {
      label: 'resendInvitation upstream failure',
      arrange: () => send.mockRejectedValueOnce(throttled()),
      run: () => client.resendInvitation(EMAIL).catch(() => undefined),
      expected: ['outcome=unavailable', 'error=TooManyRequestsException'],
    },
  ];

  const SENSITIVE = [
    EMAIL,
    'ana.perez',
    '@example.org',
    GIVEN,
    FAMILY,
    KEY_ID,
    SECRET,
    POOL_ID,
  ];

  it.each(scenarios)(
    'logs only operation and outcome for $label, and nothing sensitive',
    async ({ arrange, run, expected }) => {
      arrange();
      await run();
      const text = loggedText();
      for (const part of expected) expect(text).toContain(part);
      if (expected.length === 0) expect(text).toBe('[]');
      for (const secret of SENSITIVE) expect(text).not.toContain(secret);
    },
  );

  it('logs only operation and outcome on a timeout, and nothing sensitive', async () => {
    vi.useFakeTimers();
    send.mockImplementation(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () =>
            reject(
              Object.assign(new Error(`aborted ${EMAIL}`), {
                name: 'AbortError',
              }),
            ),
          );
        }),
    );
    const settled = client.createUser(input).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(COGNITO_ADMIN_TIMEOUT_MS);
    await settled;
    const text = loggedText();
    expect(text).toContain('outcome=unavailable');
    expect(text).toContain('error=AbortError');
    for (const secret of SENSITIVE) expect(text).not.toContain(secret);
  });
});
