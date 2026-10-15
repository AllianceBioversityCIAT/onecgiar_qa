import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';
import type { ConfigType } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { SimpleJwksCache, type JwksCache } from 'aws-jwt-verify/jwk';
import type {
  CognitoAccessTokenPayload,
  CognitoIdTokenPayload,
} from 'aws-jwt-verify/jwt-model';
import { authConfig } from '../config/auth.config.js';

/**
 * Optional override of the JWKS cache shared by both verifiers. Production
 * leaves it unbound (the library downloads and caches the pool's JWKS); tests
 * bind a cache pre-loaded with a locally generated key set (premise P-13:
 * `JwksCache.addJwks` / `CognitoJwtVerifier.create(..., { jwksCache })`).
 */
export const JWKS_CACHE = Symbol('JWKS_CACHE');

/** Every rejection reaches callers as this one error: 401, no detail on why. */
export class InvalidTokenError extends UnauthorizedException {
  constructor() {
    super(errorBody('AUTH_TOKEN_INVALID'));
  }
}

/**
 * Cognito token verification (FR-10, design section 7.2). Two verifiers over
 * one JWKS cache: access tokens (`token_use=access`) and id tokens
 * (`token_use=id`), both pinned to QA's app client and the pool's issuer.
 * Signature, `exp`/`nbf`, issuer, `token_use` and `client_id`/`aud` are all
 * enforced by `aws-jwt-verify`; anything else is a rejection (fail closed).
 */
@Injectable()
export class TokenVerifier implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenVerifier.name);

  private readonly accessVerifier;
  private readonly idVerifier;

  constructor(
    @Inject(authConfig.KEY) config: ConfigType<typeof authConfig>,
    @Optional() @Inject(JWKS_CACHE) jwksCache?: JwksCache,
  ) {
    const { userPoolId, clientId } = config.cognito;
    // One cache for both verifiers: a single JWKS download serves both.
    const cache = jwksCache ?? new SimpleJwksCache();
    this.accessVerifier = CognitoJwtVerifier.create(
      { userPoolId, clientId, tokenUse: 'access' },
      { jwksCache: cache },
    );
    this.idVerifier = CognitoJwtVerifier.create(
      { userPoolId, clientId, tokenUse: 'id' },
      { jwksCache: cache },
    );
  }

  /**
   * Warms the JWKS cache at startup. A failure is logged and swallowed: the
   * app must still boot, and the library fetches the JWKS again on first use.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.accessVerifier.hydrate();
    } catch (error) {
      this.logger.warn(
        `JWKS warm-up failed (${errorName(error)}); it will be retried on first use`,
      );
    }
  }

  /** The access token's payload, or `InvalidTokenError`. */
  async verifyAccess(token: string): Promise<CognitoAccessTokenPayload> {
    return this.verify(() => this.accessVerifier.verify(token), token);
  }

  /** The id token's payload, or `InvalidTokenError`. */
  async verifyId(token: string): Promise<CognitoIdTokenPayload> {
    return this.verify(() => this.idVerifier.verify(token), token);
  }

  private async verify<T>(run: () => Promise<T>, token: unknown): Promise<T> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new InvalidTokenError();
    }
    try {
      return await run();
    } catch (error) {
      // Only the error class is logged: never the token or its claims.
      this.logger.debug(`Token rejected (${errorName(error)})`);
      throw new InvalidTokenError();
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
