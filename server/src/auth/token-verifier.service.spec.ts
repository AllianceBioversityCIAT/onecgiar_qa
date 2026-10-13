import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SimpleJwksCache, type Fetcher } from 'aws-jwt-verify/jwk';
import {
  b64url,
  jwksOf,
  newKeyPair,
  signJwt,
  type KeyPair,
} from '../../test/support/jwt-test-keys.js';
import { authConfig } from '../config/auth.config.js';
import {
  InvalidTokenError,
  JWKS_CACHE,
  TokenVerifier,
} from './token-verifier.service.js';

// Every token below is a real RS256 JWT signed with a locally generated RSA
// key; the verifier is never mocked. No network: the JWKS is injected through
// the library's `jwksCache` option (premise P-13) or served by a fake fetcher.

const REGION = 'us-east-1';
const POOL_ID = 'us-east-1_TestPool1';
const CLIENT_ID = 'qa-client-id';
const OTHER_CLIENT_ID = 'some-other-client';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
const KID = 'kid-1';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function accessClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-sub-1',
    iss: ISSUER,
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin',
    username: 'jane',
    auth_time: nowSeconds(),
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
    jti: 'jti-1',
    ...overrides,
  };
}

function idClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-sub-1',
    iss: ISSUER,
    aud: CLIENT_ID,
    token_use: 'id',
    'cognito:username': 'jane',
    email: 'jane@cgiar.org',
    auth_time: nowSeconds(),
    iat: nowSeconds(),
    exp: nowSeconds() + 3600,
    ...overrides,
  };
}

function authConfigValue(): ConfigType<typeof authConfig> {
  return {
    cognito: { region: REGION, userPoolId: POOL_ID, clientId: CLIENT_ID },
    msAuth: { url: 'http://ms.invalid', user: 'u', password: 'p' },
    allowedOrigins: ['http://localhost:4200'],
  };
}

async function buildVerifier(
  jwksCache: SimpleJwksCache,
): Promise<TokenVerifier> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TokenVerifier,
      { provide: authConfig.KEY, useValue: authConfigValue() },
      { provide: JWKS_CACHE, useValue: jwksCache },
    ],
  }).compile();
  return moduleRef.get(TokenVerifier);
}

function cacheWith(...pairs: KeyPair[]): SimpleJwksCache {
  const cache = new SimpleJwksCache();
  cache.addJwks(JWKS_URI, jwksOf(...pairs));
  return cache;
}

describe('TokenVerifier', () => {
  const signer = newKeyPair(KID);
  const stranger = newKeyPair(KID); // same kid, different key material
  let verifier: TokenVerifier;

  beforeAll(async () => {
    verifier = await buildVerifier(cacheWith(signer));
  });

  describe('verifyAccess', () => {
    it('accepts a valid access token and returns its claims', async () => {
      const payload = await verifier.verifyAccess(
        signJwt(accessClaims(), signer),
      );

      expect(payload.sub).toBe('user-sub-1');
      expect(payload.token_use).toBe('access');
      expect(payload.client_id).toBe(CLIENT_ID);
    });

    const rejections: [label: string, token: () => string][] = [
      [
        'an expired token',
        () => signJwt(accessClaims({ exp: nowSeconds() - 3600 }), signer),
      ],
      [
        'a token from another app client',
        () => signJwt(accessClaims({ client_id: OTHER_CLIENT_ID }), signer),
      ],
      ['an id token', () => signJwt(idClaims(), signer)],
      [
        'a token with token_use=id presented as access',
        () => signJwt(accessClaims({ token_use: 'id' }), signer),
      ],
      [
        'a token signed with another key (same kid)',
        () => signJwt(accessClaims(), stranger),
      ],
      [
        'a token from another issuer',
        () =>
          signJwt(
            accessClaims({
              iss: `https://cognito-idp.${REGION}.amazonaws.com/us-east-1_Other`,
            }),
            signer,
          ),
      ],
      [
        'an unsigned token (alg none)',
        () =>
          `${b64url({ alg: 'none', typ: 'JWT', kid: KID })}.${b64url(accessClaims())}.`,
      ],
      ['garbage', () => 'not-a-jwt'],
      ['an empty string', () => ''],
      ['three dots of nothing', () => '..'],
    ];

    it.each(rejections)(
      'rejects %s with InvalidTokenError',
      async (_l, token) => {
        await expect(verifier.verifyAccess(token())).rejects.toBeInstanceOf(
          InvalidTokenError,
        );
      },
    );

    it('rejects a missing token (undefined) with InvalidTokenError', async () => {
      await expect(
        verifier.verifyAccess(undefined as unknown as string),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('maps rejections to a 401 without revealing the reason', async () => {
      const error = await verifier
        .verifyAccess(
          signJwt(accessClaims({ client_id: OTHER_CLIENT_ID }), signer),
        )
        .catch((e: unknown) => e as InvalidTokenError);

      expect(error.getStatus()).toBe(401);
      expect(error.message).toBe('Invalid or expired token');
    });
  });

  describe('verifyId', () => {
    it('accepts a valid id token and returns its claims', async () => {
      const payload = await verifier.verifyId(signJwt(idClaims(), signer));

      expect(payload.sub).toBe('user-sub-1');
      expect(payload['cognito:username']).toBe('jane');
    });

    it('rejects an access token', async () => {
      await expect(
        verifier.verifyId(signJwt(accessClaims(), signer)),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('rejects an id token from another app client', async () => {
      await expect(
        verifier.verifyId(signJwt(idClaims({ aud: OTHER_CLIENT_ID }), signer)),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('rejects an expired id token', async () => {
      await expect(
        verifier.verifyId(
          signJwt(idClaims({ exp: nowSeconds() - 3600 }), signer),
        ),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('rejects an id token signed with another key', async () => {
      await expect(
        verifier.verifyId(signJwt(idClaims(), stranger)),
      ).rejects.toBeInstanceOf(InvalidTokenError);
    });

    it('rejects garbage', async () => {
      await expect(verifier.verifyId('garbage')).rejects.toBeInstanceOf(
        InvalidTokenError,
      );
    });
  });

  describe('JWKS handling', () => {
    function fetcherFor(state: {
      jwks: object | null;
      calls: number;
    }): Fetcher {
      return {
        fetch: () => {
          state.calls += 1;
          if (state.jwks === null) {
            return Promise.reject(new Error('network down'));
          }
          const bytes = Buffer.from(JSON.stringify(state.jwks));
          return Promise.resolve(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.length,
            ),
          );
        },
      };
    }

    it('warm-up fetches the JWKS (one per issuer URL format); verification then reuses the cache', async () => {
      const state = { jwks: jwksOf(signer) as object | null, calls: 0 };
      const cache = new SimpleJwksCache({ fetcher: fetcherFor(state) });
      const warmed = await buildVerifier(cache);

      await warmed.onApplicationBootstrap();
      // aws-jwt-verify accepts both Cognito issuer formats (regional and
      // `issuer-cognito-idp` global), so it warms one JWKS URI for each.
      expect(state.calls).toBe(2);

      await warmed.verifyAccess(signJwt(accessClaims(), signer));
      await warmed.verifyId(signJwt(idClaims(), signer));
      expect(state.calls).toBe(2);
    });

    it('warm-up failure does not throw, is logged without secrets, and is retried on first use', async () => {
      const state = { jwks: null as object | null, calls: 0 };
      const cache = new SimpleJwksCache({ fetcher: fetcherFor(state) });
      const cold = await buildVerifier(cache);
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      try {
        await expect(cold.onApplicationBootstrap()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);

        // The pool becomes reachable: the first verification fetches again.
        state.jwks = jwksOf(signer);
        const payload = await cold.verifyAccess(
          signJwt(accessClaims(), signer),
        );
        expect(payload.sub).toBe('user-sub-1');
      } finally {
        warn.mockRestore();
      }
    });

    it('refreshes the JWKS when a token carries an unknown kid', async () => {
      const rotated = newKeyPair('kid-2');
      const state = {
        jwks: jwksOf(signer, rotated) as object | null,
        calls: 0,
      };
      const cache = new SimpleJwksCache({ fetcher: fetcherFor(state) });
      cache.addJwks(JWKS_URI, jwksOf(signer)); // stale: knows only kid-1
      const stale = await buildVerifier(cache);

      const payload = await stale.verifyAccess(
        signJwt(accessClaims(), rotated),
      );

      expect(payload.sub).toBe('user-sub-1');
      expect(state.calls).toBe(1);
    });
  });

  describe('logging', () => {
    it('never logs the token or its claims, even on rejection', async () => {
      const token = signJwt(
        accessClaims({ client_id: OTHER_CLIENT_ID }),
        signer,
      );
      const spies = (['log', 'debug', 'warn', 'error', 'verbose'] as const).map(
        (level) =>
          vi.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );

      try {
        await verifier.verifyAccess(token).catch(() => undefined);
        const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(token.split('.')[1]);
        expect(logged).not.toContain('user-sub-1');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });
});
