import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from '../config/auth.config.js';
import {
  AuthMicroserviceClient,
  InvalidCredentialsError,
  UpstreamUnavailableError,
} from './auth-microservice.client.js';

// Fixtures mirror the microservice at commit bf29541f (premises P-2..P-6):
//  - custom login      auth.service.ts:169-205  -> { tokens } | { challengeName, session, ... }
//  - complete password auth.service.ts:212-232  -> { message, tokens }
//  - provider login    auth.service.ts:50-84    -> { authUrl }
//  - validate code     auth.service.ts:95-165   -> { ...tokens (flat), userInfo }
//  - refresh           auth.service.ts:571-625  -> flat tokens + userInfo; undefined on error (P-6)
//  - auth header       jwt-clarisa.middleware.ts:23-46

const config = {
  msAuth: {
    url: 'https://ms.test/',
    user: 'qa-client',
    password: 'ms-secret-pw',
  },
} as ConfigType<typeof authConfig>;

const SECRET_BODY_MARK = 'SECRET-BODY-MARK';
const TOKENS = {
  accessToken: 'at.jwt',
  idToken: 'id.jwt',
  refreshToken: 'rt-opaque',
  expiresIn: 3600,
  tokenType: 'Bearer',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
let client: AuthMicroserviceClient;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = new AuthMicroserviceClient(config);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lastCall = () => {
  expect(fetchMock).toHaveBeenCalled();
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
};

describe('AuthMicroserviceClient', () => {
  it('loginCustom sends the auth header and username = email (P-2, P-5)', async () => {
    fetchMock.mockResolvedValue(json({ tokens: TOKENS }));
    const result = await client.loginCustom('ana@cgiar.org', 'pw');
    const call = lastCall();
    expect(call.url).toBe('https://ms.test/auth/login/custom');
    expect(JSON.parse(call.headers.auth)).toEqual({
      username: 'qa-client',
      password: 'ms-secret-pw',
    });
    expect(call.body).toEqual({ username: 'ana@cgiar.org', password: 'pw' });
    expect(result).toEqual({
      kind: 'tokens',
      tokens: {
        accessToken: 'at.jwt',
        idToken: 'id.jwt',
        refreshToken: 'rt-opaque',
      },
    });
  });

  it('loginCustom returns the NEW_PASSWORD_REQUIRED challenge without tokens', async () => {
    fetchMock.mockResolvedValue(
      json({
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'sess-1',
        userAttributes: { email: 'ana@cgiar.org' },
        userId: 'u-1',
        message: 'Password change required. User must set a new password.',
      }),
    );
    expect(await client.loginCustom('ana@cgiar.org', 'pw')).toEqual({
      kind: 'challenge',
      challengeName: 'NEW_PASSWORD_REQUIRED',
      session: 'sess-1',
    });
  });

  it('completeNewPassword posts { username, newPassword, session } and returns tokens', async () => {
    fetchMock.mockResolvedValue(
      json({ message: 'Password updated successfully', tokens: TOKENS }),
    );
    const tokens = await client.completeNewPassword(
      'ana@cgiar.org',
      'New-pw-1',
      'sess-1',
    );
    const call = lastCall();
    expect(call.url).toBe(
      'https://ms.test/auth/complete-new-password-challenge',
    );
    expect(call.body).toEqual({
      username: 'ana@cgiar.org',
      newPassword: 'New-pw-1',
      session: 'sess-1',
    });
    expect(tokens.idToken).toBe('id.jwt');
  });

  it('providerUrl posts the SSO provider and returns authUrl (P-3)', async () => {
    fetchMock.mockResolvedValue(
      json({ authUrl: 'https://cognito.test/oauth2/authorize?x=1' }),
    );
    expect(await client.providerUrl('https://qa.test/cb')).toBe(
      'https://cognito.test/oauth2/authorize?x=1',
    );
    const call = lastCall();
    expect(call.url).toBe('https://ms.test/auth/login/provider');
    expect(call.body).toEqual({
      provider: 'CGIAR-AzureAD',
      redirectUri: 'https://qa.test/cb',
    });
  });

  it('validateCode posts { code, redirectUri } and reads flat tokens (P-4)', async () => {
    fetchMock.mockResolvedValue(
      json({ ...TOKENS, userInfo: { email: 'ana@cgiar.org' } }),
    );
    const tokens = await client.validateCode('abc123', 'https://qa.test/cb');
    const call = lastCall();
    expect(call.url).toBe('https://ms.test/auth/validate/code');
    expect(call.body).toEqual({
      code: 'abc123',
      redirectUri: 'https://qa.test/cb',
    });
    expect(tokens).toEqual({
      accessToken: 'at.jwt',
      idToken: 'id.jwt',
      refreshToken: 'rt-opaque',
    });
  });

  // Request shape per DD-2 (design section 9), pending microservice change:
  // the shipped bf29541f contract takes { refreshToken, accessToken? } only.
  it('refresh posts { refreshToken, username } per DD-2, pending microservice change', async () => {
    fetchMock.mockResolvedValue(json({ ...TOKENS, userInfo: {} }));
    const result = await client.refresh('rt-opaque', 'cognito-user-1');
    const call = lastCall();
    expect(call.url).toBe('https://ms.test/auth/refresh');
    expect(call.body).toEqual({
      refreshToken: 'rt-opaque',
      username: 'cognito-user-1',
    });
    expect(result).toEqual({
      accessToken: 'at.jwt',
      idToken: 'id.jwt',
      refreshToken: 'rt-opaque',
    });
  });

  it('maps a 4xx to InvalidCredentialsError', async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 401, message: 'Authentication failed' }, 401),
    );
    await expect(client.loginCustom('a@b.org', 'bad')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    fetchMock.mockResolvedValue(json({ message: 'bad' }, 400));
    await expect(
      client.completeNewPassword('a', 'b', 'c'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('maps a 5xx to UpstreamUnavailableError', async () => {
    fetchMock.mockResolvedValue(json({ message: 'boom' }, 500));
    await expect(client.loginCustom('a@b.org', 'pw')).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    fetchMock.mockResolvedValue(json({ message: 'bad gateway' }, 502));
    await expect(client.providerUrl()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('maps a network error to UpstreamUnavailableError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.validateCode('c')).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('aborts after 10 s and maps the timeout to UpstreamUnavailableError', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    // Track the outcome without awaiting it: a client that never aborts leaves
    // this promise pending, and every check below must fail as an assertion,
    // never as a hang or a setup crash.
    const outcome: { settled: boolean; error?: unknown } = { settled: false };
    void client.loginCustom('a@b.org', 'pw').then(
      () => {
        outcome.settled = true;
      },
      (error: unknown) => {
        outcome.settled = true;
        outcome.error = error;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    expect(outcome.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(UpstreamUnavailableError);
  });

  it('treats an empty 2xx refresh body as invalid (P-6: undefined handler result)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    await expect(client.refresh('rt', 'u')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('treats a malformed or incomplete 2xx body as invalid', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(client.loginCustom('a@b.org', 'pw')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    fetchMock.mockResolvedValue(json({ tokens: { accessToken: 'x' } }));
    await expect(client.loginCustom('a@b.org', 'pw')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    fetchMock.mockResolvedValue(json({}));
    await expect(client.providerUrl()).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('never logs bodies, tokens or passwords', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
    const leaky = { message: SECRET_BODY_MARK, ...TOKENS };
    for (const status of [200, 401, 500]) {
      fetchMock.mockResolvedValue(json(leaky, status));
      await client
        .loginCustom('ana@cgiar.org', 'user-pw-secret')
        .catch(() => undefined);
    }
    fetchMock.mockResolvedValue(
      new Response(`${SECRET_BODY_MARK} not json`, { status: 200 }),
    );
    await client.refresh('rt-opaque', 'u').catch(() => undefined);
    fetchMock.mockRejectedValue(new TypeError(SECRET_BODY_MARK));
    await client.refresh('rt-opaque', 'u').catch(() => undefined);

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged.length).toBeGreaterThan(2); // something was logged, so the spy is live
    for (const secret of [
      SECRET_BODY_MARK,
      'at.jwt',
      'id.jwt',
      'rt-opaque',
      'user-pw-secret',
      'ms-secret-pw',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
