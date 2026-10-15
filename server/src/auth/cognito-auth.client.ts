import { createHmac } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config.js';

/** Timeout for every Cognito call (NFR-6). */
export const COGNITO_TIMEOUT_MS = 10_000;

/** SSO identity provider configured on the app client. */
export const SSO_PROVIDER = 'CGIAR-AzureAD';

/** Hosted UI scopes. `profile` is not allowed on the app client (P-18). */
export const SSO_SCOPES = 'openid email';

/** 4xx, a refused challenge or missing tokens: 401 with no detail on why (FR-4, FR-13). */
export class InvalidCredentialsError extends UnauthorizedException {
  constructor() {
    super('Invalid credentials');
  }
}

/** Timeout, 5xx, throttling or network failure: 503 (NFR-6). */
export class UpstreamUnavailableError extends ServiceUnavailableException {
  constructor() {
    super('Authentication service unavailable');
  }
}

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export type LoginResult =
  | { kind: 'tokens'; tokens: CognitoTokens }
  | {
      kind: 'challenge';
      challengeName: 'NEW_PASSWORD_REQUIRED';
      session: string;
    };

export interface RefreshResult {
  accessToken: string;
  idToken: string;
  /** Present only when the app client rotates refresh tokens. */
  refreshToken?: string;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * The Cognito error name, from `__type` (user-pool API, possibly prefixed
 * `com.amazonaws…#`) or `error` (OAuth). Only a bare identifier is returned, so
 * nothing else from the body can reach a log line.
 */
function errorTypeOf(body: unknown): string {
  const raw = isObject(body) ? (body.__type ?? body.error) : undefined;
  return typeof raw === 'string'
    ? safeName(raw.split('#').pop() ?? '')
    : 'unknown';
}

/** A Cognito-supplied name, only if it is a bare identifier (NFR-7: nothing else reaches a log). */
function safeName(name: string): string {
  return /^\w{1,64}$/.test(name) ? name : 'unknown';
}

/** Cognito errors that mean "try later", not "wrong credentials". */
const THROTTLED = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
]);

/**
 * Adapter over Cognito (design 7.2, DD-11): the user-pool API for password
 * login, the new-password challenge, refresh and revocation, and the Hosted UI
 * for SSO. Maps every failure to a typed error and never logs bodies, tokens,
 * passwords or the client secret (NFR-7, FR-17).
 */
@Injectable()
export class CognitoAuthClient {
  private readonly logger = new Logger(CognitoAuthClient.name);

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** `InitiateAuth USER_PASSWORD_AUTH`; the username is the email. */
  async loginCustom(email: string, password: string): Promise<LoginResult> {
    const body = await this.idp('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.config.cognito.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: this.secretHash(email),
      },
    });
    if (body.ChallengeName === 'NEW_PASSWORD_REQUIRED' && isStr(body.Session)) {
      return {
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: body.Session,
      };
    }
    return { kind: 'tokens', tokens: this.tokens(body, 'InitiateAuth') };
  }

  /** `RespondToAuthChallenge NEW_PASSWORD_REQUIRED`. */
  async completeNewPassword(
    username: string,
    newPassword: string,
    session: string,
  ): Promise<CognitoTokens> {
    const body = await this.idp('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: this.config.cognito.clientId,
      Session: session,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
        SECRET_HASH: this.secretHash(username),
      },
    });
    return this.tokens(body, 'RespondToAuthChallenge');
  }

  /** The Hosted UI authorize URL for the SSO provider. Built locally; no call. */
  async providerUrl(redirectUri: string): Promise<string> {
    const url = new URL(`${this.hostedUi()}/oauth2/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.cognito.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SSO_SCOPES);
    url.searchParams.set('identity_provider', SSO_PROVIDER);
    return url.toString();
  }

  /** `POST /oauth2/token` (authorization code grant, HTTP Basic client auth). */
  async validateCode(
    code: string,
    redirectUri: string,
  ): Promise<CognitoTokens> {
    const { clientId, clientSecret } = this.config.cognito;
    const body = await this.send(
      'oauth2/token',
      `${this.hostedUi()}/oauth2/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
        }).toString(),
      },
    );
    if (
      !isStr(body.access_token) ||
      !isStr(body.id_token) ||
      !isStr(body.refresh_token)
    ) {
      this.logger.warn('upstream_bad_body op=oauth2/token');
      throw new InvalidCredentialsError();
    }
    return {
      accessToken: body.access_token,
      idToken: body.id_token,
      refreshToken: body.refresh_token,
    };
  }

  /**
   * `InitiateAuth REFRESH_TOKEN_AUTH`. `username` is the id token's
   * `cognito:username` (DD-2): Cognito checks `SECRET_HASH` against it, so no
   * access token is needed.
   */
  async refresh(
    refreshToken: string,
    username: string,
  ): Promise<RefreshResult> {
    const body = await this.idp('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this.config.cognito.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        SECRET_HASH: this.secretHash(username),
      },
    });
    const result = body.AuthenticationResult;
    if (
      !isObject(result) ||
      !isStr(result.AccessToken) ||
      !isStr(result.IdToken)
    ) {
      this.logger.warn('upstream_bad_body op=InitiateAuth');
      throw new InvalidCredentialsError();
    }
    return {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      ...(isStr(result.RefreshToken)
        ? { refreshToken: result.RefreshToken }
        : {}),
    };
  }

  /** `RevokeToken`: the refresh token (and the tokens it issued) stop working. */
  async revoke(refreshToken: string): Promise<void> {
    const { clientId, clientSecret } = this.config.cognito;
    await this.idp('RevokeToken', {
      Token: refreshToken,
      ClientId: clientId,
      ClientSecret: clientSecret,
    });
  }

  private secretHash(username: string): string {
    const { clientId, clientSecret } = this.config.cognito;
    return createHmac('sha256', clientSecret)
      .update(username + clientId)
      .digest('base64');
  }

  private hostedUi(): string {
    return this.config.cognito.hostedUiUrl.replace(/\/+$/, '');
  }

  /** Tokens from an `AuthenticationResult`; anything else (another challenge) is a 401. */
  private tokens(body: Json, op: string): CognitoTokens {
    const r = body.AuthenticationResult;
    if (
      isObject(r) &&
      isStr(r.AccessToken) &&
      isStr(r.IdToken) &&
      isStr(r.RefreshToken)
    ) {
      return {
        accessToken: r.AccessToken,
        idToken: r.IdToken,
        refreshToken: r.RefreshToken,
      };
    }
    this.logger.warn(
      `upstream_refused op=${op} reason=${isStr(body.ChallengeName) ? `challenge_${safeName(body.ChallengeName)}` : 'no_tokens'}`,
    );
    throw new InvalidCredentialsError();
  }

  private idp(op: string, payload: Json): Promise<Json> {
    return this.send(op, this.config.cognito.userPoolUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${op}`,
      },
      body: JSON.stringify(payload),
    });
  }

  private async send(
    op: string,
    url: string,
    init: RequestInit,
  ): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COGNITO_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      let body: unknown;
      try {
        body = text === '' ? {} : JSON.parse(text);
      } catch {
        body = undefined;
      }
      if (res.status >= 400) {
        // Cognito names the error in `__type` (user-pool API) or `error` (OAuth).
        const type = errorTypeOf(body);
        if (res.status >= 500 || THROTTLED.has(type)) {
          this.logger.warn(
            `upstream_unavailable op=${op} status=${res.status} type=${type}`,
          );
          throw new UpstreamUnavailableError();
        }
        this.logger.warn(
          `upstream_refused op=${op} status=${res.status} type=${type}`,
        );
        throw new InvalidCredentialsError();
      }
      if (!isObject(body)) {
        this.logger.warn(`upstream_bad_body op=${op}`);
        throw new InvalidCredentialsError();
      }
      return body;
    } catch (err) {
      if (
        err instanceof InvalidCredentialsError ||
        err instanceof UpstreamUnavailableError
      ) {
        throw err;
      }
      this.logger.warn(
        `upstream_unavailable op=${op} reason=${controller.signal.aborted ? 'timeout' : 'network'}`,
      );
      throw new UpstreamUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
