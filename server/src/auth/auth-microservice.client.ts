import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config.js';

/** Timeout for every microservice call (NFR-6). */
export const MS_AUTH_TIMEOUT_MS = 10_000;

/** SSO provider name sent to the microservice (premise P-3). */
export const SSO_PROVIDER = 'CGIAR-AzureAD';

/** 4xx, empty or malformed body: 401 with no detail on why (FR-4, FR-13). */
export class InvalidCredentialsError extends UnauthorizedException {
  constructor() {
    super('Invalid credentials');
  }
}

/** Timeout, 5xx or network failure: 503 (NFR-6). */
export class UpstreamUnavailableError extends ServiceUnavailableException {
  constructor() {
    super('Authentication service unavailable');
  }
}

export interface MsTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export type LoginResult =
  | { kind: 'tokens'; tokens: MsTokens }
  | {
      kind: 'challenge';
      challengeName: 'NEW_PASSWORD_REQUIRED';
      session: string;
    };

export interface RefreshResult {
  accessToken: string;
  idToken: string;
  /** Present when the microservice returns one (it falls back to the input). */
  refreshToken?: string;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

function toTokens(v: unknown): MsTokens | undefined {
  if (
    isObject(v) &&
    isStr(v.accessToken) &&
    isStr(v.idToken) &&
    isStr(v.refreshToken)
  ) {
    return {
      accessToken: v.accessToken,
      idToken: v.idToken,
      refreshToken: v.refreshToken,
    };
  }
  return undefined;
}

/**
 * Adapter over the auth microservice (design section 7.2). Sends the `auth`
 * header (P-5), maps every failure to a typed error and never logs request or
 * response bodies, tokens or passwords (NFR-7).
 */
@Injectable()
export class AuthMicroserviceClient {
  private readonly logger = new Logger(AuthMicroserviceClient.name);

  constructor(
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** `POST /auth/login/custom`; `username` is the email (P-2). */
  async loginCustom(email: string, password: string): Promise<LoginResult> {
    const body = await this.post('login/custom', { username: email, password });
    if (
      isObject(body) &&
      body.challengeName === 'NEW_PASSWORD_REQUIRED' &&
      isStr(body.session)
    ) {
      return {
        kind: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: body.session,
      };
    }
    const tokens = isObject(body) ? toTokens(body.tokens) : undefined;
    if (!tokens) throw new InvalidCredentialsError();
    return { kind: 'tokens', tokens };
  }

  /** `POST /auth/complete-new-password-challenge`. */
  async completeNewPassword(
    username: string,
    newPassword: string,
    session: string,
  ): Promise<MsTokens> {
    const body = await this.post('complete-new-password-challenge', {
      username,
      newPassword,
      session,
    });
    const tokens = isObject(body) ? toTokens(body.tokens) : undefined;
    if (!tokens) throw new InvalidCredentialsError();
    return tokens;
  }

  /** `POST /auth/login/provider` (P-3): the SSO authorize URL. */
  async providerUrl(redirectUri?: string): Promise<string> {
    const body = await this.post('login/provider', {
      provider: SSO_PROVIDER,
      ...(redirectUri === undefined ? {} : { redirectUri }),
    });
    if (!isObject(body) || !isStr(body.authUrl))
      throw new InvalidCredentialsError();
    return body.authUrl;
  }

  /** `POST /auth/validate/code`: tokens are flat in the response (P-4). */
  async validateCode(code: string, redirectUri?: string): Promise<MsTokens> {
    const body = await this.post('validate/code', {
      code,
      ...(redirectUri === undefined ? {} : { redirectUri }),
    });
    const tokens = toTokens(body);
    if (!tokens) throw new InvalidCredentialsError();
    return tokens;
  }

  /**
   * `POST /auth/refresh` with `{ refreshToken, username }` (DD-2, design
   * section 9: pending microservice change). An empty 2xx body is a refusal (P-6).
   */
  async refresh(
    refreshToken: string,
    username: string,
  ): Promise<RefreshResult> {
    const body = await this.post('refresh', { refreshToken, username });
    if (!isObject(body) || !isStr(body.accessToken) || !isStr(body.idToken)) {
      throw new InvalidCredentialsError();
    }
    return {
      accessToken: body.accessToken,
      idToken: body.idToken,
      ...(isStr(body.refreshToken) ? { refreshToken: body.refreshToken } : {}),
    };
  }

  private async post(path: string, payload: Json): Promise<unknown> {
    const { url, user, password } = this.config.msAuth;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MS_AUTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/auth/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          auth: JSON.stringify({ username: user, password }),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.status >= 500) {
        this.logger.warn(
          `upstream_unavailable route=${path} reason=status_${res.status}`,
        );
        throw new UpstreamUnavailableError();
      }
      if (res.status >= 400) {
        this.logger.warn(`upstream_refused route=${path} status=${res.status}`);
        throw new InvalidCredentialsError();
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        this.logger.warn(`upstream_bad_body route=${path}`);
        throw new InvalidCredentialsError();
      }
    } catch (err) {
      if (
        err instanceof InvalidCredentialsError ||
        err instanceof UpstreamUnavailableError
      ) {
        throw err;
      }
      this.logger.warn(
        `upstream_unavailable route=${path} reason=${controller.signal.aborted ? 'timeout' : 'network'}`,
      );
      throw new UpstreamUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
