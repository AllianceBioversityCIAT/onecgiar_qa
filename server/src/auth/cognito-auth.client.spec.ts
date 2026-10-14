import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from '../config/auth.config.js';
import {
  COGNITO_TIMEOUT_MS,
  CognitoAuthClient,
  InvalidCredentialsError,
  UpstreamUnavailableError,
} from './cognito-auth.client.js';

// Fixtures follow the Cognito API shapes seen against the real pool on
// 2026-10-14 (design P-18): `AuthenticationResult` with PascalCase tokens from
// the user-pool API, snake_case tokens from `/oauth2/token`, errors named in
// `__type` (user-pool API) or `error` (OAuth).

const CLIENT_ID = 'qa-client-id';
const CLIENT_SECRET = 'client-secret-SECRET';
const POOL_URL = 'https://cognito-idp.test.invalid/';
const HOSTED_UI = 'https://qa.auth.us-east-1.amazoncognito.com/';

const config = {
  cognito: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    hostedUiUrl: HOSTED_UI,
    userPoolUrl: POOL_URL,
  },
  allowedOrigins: ['http://localhost:4200'],
} as ConfigType<typeof authConfig>;

const SECRET_BODY_MARK = 'SECRET-BODY-MARK';
const RESULT = {
  AccessToken: 'at.jwt',
  IdToken: 'id.jwt',
  RefreshToken: 'rt-opaque',
  ExpiresIn: 3600,
  TokenType: 'Bearer',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const cognitoError = (type: string, status = 400) =>
  json({ __type: type, message: `detail ${SECRET_BODY_MARK}` }, status);
const hash = (username: string) =>
  createHmac('sha256', CLIENT_SECRET)
    .update(username + CLIENT_ID)
    .digest('base64');

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
let client: CognitoAuthClient;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = new CognitoAuthClient(config);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lastCall = () => {
  expect(fetchMock).toHaveBeenCalled();
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};
const lastIdpBody = () =>
  JSON.parse(lastCall().init.body as string) as Record<string, any>;

describe('CognitoAuthClient — user-pool API', () => {
  it('logs in with USER_PASSWORD_AUTH, the email as username and its SECRET_HASH', async () => {
    fetchMock.mockResolvedValue(json({ AuthenticationResult: RESULT }));

    const result = await client.loginCustom('ada@cgiar.org', 'pw');

    expect(result).toEqual({
      kind: 'tokens',
      tokens: {
        accessToken: 'at.jwt',
        idToken: 'id.jwt',
        refreshToken: 'rt-opaque',
      },
    });
    const { url, headers } = lastCall();
    expect(url).toBe(POOL_URL);
    expect(headers['x-amz-target']).toBe(
      'AWSCognitoIdentityProviderService.InitiateAuth',
    );
    expect(headers['content-type']).toBe('application/x-amz-json-1.1');
    expect(lastIdpBody()).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: 'ada@cgiar.org',
        PASSWORD: 'pw',
        SECRET_HASH: hash('ada@cgiar.org'),
      },
    });
  });

  it('returns the NEW_PASSWORD_REQUIRED challenge with its session and no tokens', async () => {
    fetchMock.mockResolvedValue(
      json({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'sess-1',
        ChallengeParameters: {},
      }),
    );
    await expect(client.loginCustom('ada@cgiar.org', 'pw')).resolves.toEqual({
      kind: 'challenge',
      challengeName: 'NEW_PASSWORD_REQUIRED',
      session: 'sess-1',
    });
  });

  it('refuses any other challenge (e.g. MFA) as invalid credentials', async () => {
    fetchMock.mockResolvedValue(
      json({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 's' }),
    );
    await expect(
      client.loginCustom('ada@cgiar.org', 'pw'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('completes the new password with RespondToAuthChallenge and the SECRET_HASH of the username', async () => {
    fetchMock.mockResolvedValue(json({ AuthenticationResult: RESULT }));

    const tokens = await client.completeNewPassword(
      'ada@cgiar.org',
      'NewPw1!',
      'sess-1',
    );

    expect(tokens.refreshToken).toBe('rt-opaque');
    expect(lastCall().headers['x-amz-target']).toBe(
      'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    );
    expect(lastIdpBody()).toEqual({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: CLIENT_ID,
      Session: 'sess-1',
      ChallengeResponses: {
        USERNAME: 'ada@cgiar.org',
        NEW_PASSWORD: 'NewPw1!',
        SECRET_HASH: hash('ada@cgiar.org'),
      },
    });
  });

  it('refreshes with REFRESH_TOKEN_AUTH and the SECRET_HASH of cognito:username, no access token', async () => {
    const { RefreshToken: _dropped, ...noRotation } = RESULT;
    fetchMock.mockResolvedValue(json({ AuthenticationResult: noRotation }));

    const result = await client.refresh('rt-opaque', 'CGIAR-AzureAD_ana');

    expect(result).toEqual({ accessToken: 'at.jwt', idToken: 'id.jwt' });
    expect(lastIdpBody()).toEqual({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: 'rt-opaque',
        SECRET_HASH: hash('CGIAR-AzureAD_ana'),
      },
    });
  });

  it('returns a rotated refresh token when Cognito sends one', async () => {
    fetchMock.mockResolvedValue(
      json({ AuthenticationResult: { ...RESULT, RefreshToken: 'rt-new' } }),
    );
    await expect(client.refresh('rt-opaque', 'ada')).resolves.toMatchObject({
      refreshToken: 'rt-new',
    });
  });

  it('refuses a refresh answer without tokens', async () => {
    fetchMock.mockResolvedValue(json({}));
    await expect(client.refresh('rt', 'ada')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('revokes with RevokeToken, sending the client secret, and accepts an empty 200', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(client.revoke('rt-opaque')).resolves.toBeUndefined();

    expect(lastCall().headers['x-amz-target']).toBe(
      'AWSCognitoIdentityProviderService.RevokeToken',
    );
    expect(lastIdpBody()).toEqual({
      Token: 'rt-opaque',
      ClientId: CLIENT_ID,
      ClientSecret: CLIENT_SECRET,
    });
  });
});

describe('CognitoAuthClient — Hosted UI', () => {
  it('builds the authorize URL locally for CGIAR-AzureAD with openid email scopes', async () => {
    const url = new URL(
      await client.providerUrl('http://localhost:4200/auth/callback'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://qa.auth.us-east-1.amazoncognito.com/oauth2/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'http://localhost:4200/auth/callback',
      scope: 'openid email',
      identity_provider: 'CGIAR-AzureAD',
    });
    expect(url.toString()).not.toContain(CLIENT_SECRET);
  });

  it('exchanges the code at /oauth2/token with HTTP Basic client auth', async () => {
    fetchMock.mockResolvedValue(
      json({
        access_token: 'at.jwt',
        id_token: 'id.jwt',
        refresh_token: 'rt-opaque',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    );

    const tokens = await client.validateCode(
      'code-1',
      'http://localhost:4200/auth/callback',
    );

    expect(tokens).toEqual({
      accessToken: 'at.jwt',
      idToken: 'id.jwt',
      refreshToken: 'rt-opaque',
    });
    const { url, headers, init } = lastCall();
    expect(url).toBe(
      'https://qa.auth.us-east-1.amazoncognito.com/oauth2/token',
    );
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(
      Object.fromEntries(new URLSearchParams(init.body as string)),
    ).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'code-1',
      redirect_uri: 'http://localhost:4200/auth/callback',
    });
  });

  it('maps invalid_grant (bad or reused code) to invalid credentials', async () => {
    fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400));
    await expect(
      client.validateCode('used', 'http://localhost:4200/cb'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refuses a token answer without a refresh token', async () => {
    fetchMock.mockResolvedValue(json({ access_token: 'a', id_token: 'i' }));
    await expect(
      client.validateCode('c', 'http://localhost:4200/cb'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('CognitoAuthClient — error mapping (FR-4, NFR-6, NFR-7)', () => {
  const login = () => client.loginCustom('ada@cgiar.org', 'pw-SECRET');

  it.each([
    'NotAuthorizedException',
    'UserNotFoundException',
    'PasswordResetRequiredException',
  ])(
    '%s → invalid credentials (no hint whether the email exists)',
    async (type) => {
      fetchMock.mockResolvedValue(cognitoError(`com.amazonaws#${type}`));
      await expect(login()).rejects.toBeInstanceOf(InvalidCredentialsError);
    },
  );

  it.each(['TooManyRequestsException', 'LimitExceededException'])(
    '%s → upstream unavailable',
    async (type) => {
      fetchMock.mockResolvedValue(cognitoError(type));
      await expect(login()).rejects.toBeInstanceOf(UpstreamUnavailableError);
    },
  );

  it('5xx → upstream unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(login()).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('network failure → upstream unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(login()).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('a malformed 2xx body → invalid credentials', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(login()).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it(`aborts after ${COGNITO_TIMEOUT_MS} ms → upstream unavailable`, async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const pending = login();
    const settled = expect(pending).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(COGNITO_TIMEOUT_MS);
    await settled;
  });

  it('never logs bodies, tokens, passwords or the client secret', async () => {
    fetchMock.mockResolvedValueOnce(cognitoError('NotAuthorizedException'));
    await expect(login()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(
      json({ ChallengeName: 'SMS_MFA', Session: `s-${SECRET_BODY_MARK}` }),
    );
    await expect(login()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(
      json({ access_token: `a-${SECRET_BODY_MARK}` }),
    );
    await expect(
      client.validateCode('c', 'http://localhost:4200/cb'),
    ).rejects.toThrow();

    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('type=NotAuthorizedException');
    for (const secret of [
      SECRET_BODY_MARK,
      'pw-SECRET',
      CLIENT_SECRET,
      'rt-opaque',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
