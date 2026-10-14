import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import type { RequestWithId } from '../common/request-id.js';
import { authConfig } from '../config/auth.config.js';
import { AdmissionService } from './admission.service.js';
import { AuthDecisionInterceptor, logAuthDecision } from './auth-decision.js';
import {
  AuthMicroserviceClient,
  InvalidCredentialsError,
  type MsTokens,
  UpstreamUnavailableError,
} from './auth-microservice.client.js';
import { AuthThrottle } from './auth-throttle.js';
import { UsernameClaimMissingError } from './auth.errors.js';
import { Public } from './decorators/public.decorator.js';
import { CallbackDto } from './dto/callback.dto.js';
import { CompleteNewPasswordDto } from './dto/complete-new-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ProviderUrlQuery } from './dto/provider-url.query.js';
import { type UserProfile, toUserProfile } from './me.controller.js';
import { assertAllowedRedirectUri } from './redirect-uri.js';
import { setSessionCookies } from './session-cookies.js';
import { TokenVerifier } from './token-verifier.service.js';

/** FR-9: the success shape; the refresh token travels only in the cookie. */
export interface SessionResponse {
  accessToken: string;
  /** Seconds the access token is still valid. */
  expiresIn: number;
  user: UserProfile;
}

/** FR-4: the first-login challenge; no tokens, no cookie. */
export interface ChallengeResponse {
  challenge: 'NEW_PASSWORD_REQUIRED';
  session: string;
}

/**
 * Login, complete-new-password, provider-url and callback (design 7.2, 7.3).
 * Thin: validate, call the microservice, admit, set the cookies. Every route
 * is public (FR-10); the three that take credentials or a code are throttled
 * (NFR-4). The interceptor records every failure; only a successful login
 * sends `Set-Cookie` (FR-9). Bodies are JSON only: `requireJsonPost` refuses
 * any other POST before it gets here (FR-4).
 */
@Public()
@UseInterceptors(AuthDecisionInterceptor)
@Controller('auth')
export class AuthController {
  private readonly allowedOrigins: readonly string[];

  constructor(
    @Inject(AuthMicroserviceClient)
    private readonly client: AuthMicroserviceClient,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
    @Inject(authConfig.KEY) config: ConfigType<typeof authConfig>,
  ) {
    this.allowedOrigins = config.allowedOrigins;
  }

  @AuthThrottle()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse | ChallengeResponse> {
    const result = await this.client.loginCustom(dto.email, dto.password);
    if (result.kind === 'challenge') {
      // Admission (FR-8) waits until the challenge completes (FR-5).
      logAuthDecision(request, {
        outcome: 'challenge',
        status: 200,
        reason: 'new_password_required',
      });
      return { challenge: result.challengeName, session: result.session };
    }
    return this.issueSession(request, response, result.tokens);
  }

  @AuthThrottle()
  @HttpCode(200)
  @Post('complete-new-password')
  async completeNewPassword(
    @Body() dto: CompleteNewPasswordDto,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const tokens = await this.client.completeNewPassword(
      dto.email,
      dto.newPassword,
      dto.session,
    );
    return this.issueSession(request, response, tokens);
  }

  @Get('provider-url')
  async providerUrl(
    @Query() query: ProviderUrlQuery,
    @Req() request: RequestWithId,
  ): Promise<{ url: string }> {
    assertAllowedRedirectUri(query.redirectUri, this.allowedOrigins);
    let url: string;
    try {
      url = await this.client.providerUrl(query.redirectUri);
    } catch (error) {
      // No credentials are involved here (design 6 lists 400 and 503 only):
      // when the microservice refuses to build the URL, QA's own call is at
      // fault, which the caller sees as an unavailable service.
      throw error instanceof InvalidCredentialsError
        ? new UpstreamUnavailableError()
        : error;
    }
    logAuthDecision(request, {
      outcome: 'ok',
      status: 200,
      reason: 'provider_url_issued',
    });
    return { url };
  }

  @AuthThrottle()
  @HttpCode(200)
  @Post('callback')
  async callback(
    @Body() dto: CallbackDto,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    assertAllowedRedirectUri(dto.redirectUri, this.allowedOrigins);
    const tokens = await this.client.validateCode(dto.code, dto.redirectUri);
    return this.issueSession(request, response, tokens);
  }

  /**
   * FR-8 and FR-9 for tokens the microservice just issued. Nothing reaches the
   * response before every check has passed, and the cookies are set last.
   */
  private async issueSession(
    request: RequestWithId,
    response: Response,
    tokens: MsTokens,
  ): Promise<SessionResponse> {
    // The access token is what the caller will present next: it must be one
    // this API accepts. Its expiry is the source of `expiresIn`.
    const access = await this.verifier.verifyAccess(tokens.accessToken);
    const { user, cognitoUsername } = await this.admission.resolve(
      tokens.idToken,
      { mode: 'login' },
    );
    // Fail closed: refresh needs the username, so a session without it is refused.
    if (cognitoUsername === null) throw new UsernameClaimMissingError();

    const body: SessionResponse = {
      accessToken: tokens.accessToken,
      expiresIn: Math.max(0, access.exp - Math.floor(Date.now() / 1000)),
      user: toUserProfile(user),
    };
    setSessionCookies(response, tokens.refreshToken, cognitoUsername);
    logAuthDecision(request, {
      outcome: 'ok',
      status: 200,
      reason: 'session_issued',
      userId: user.id,
    });
    return body;
  }
}
