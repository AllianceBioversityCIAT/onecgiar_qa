import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../common/openapi.js';
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
  CognitoAuthClient,
  type CognitoTokens,
} from './cognito-auth.client.js';
import { AuthThrottle } from './auth-throttle.js';
import { UsernameClaimMissingError } from './auth.errors.js';
import { Public } from './decorators/public.decorator.js';
import { CallbackDto } from './dto/callback.dto.js';
import { CompleteNewPasswordDto } from './dto/complete-new-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ProviderUrlQuery } from './dto/provider-url.query.js';
import { UserProfile, toUserProfile } from './me.controller.js';
import { assertAllowedRedirectUri } from './redirect-uri.js';
import { setSessionCookies } from './session-cookies.js';
import { TokenVerifier } from './token-verifier.service.js';

/** FR-9: the success shape; the refresh token travels only in the cookie. */
export class SessionResponse {
  @ApiProperty({
    type: String,
    description:
      'Cognito access token: send it as `Authorization: Bearer …`. Keep it in memory only',
  })
  accessToken!: string;

  /** Seconds the access token is still valid. */
  @ApiProperty({
    type: Number,
    description: 'Seconds the access token is still valid',
    example: 3600,
  })
  expiresIn!: number;

  @ApiProperty({ type: UserProfile })
  user!: UserProfile;
}

/** FR-4: the first-login challenge; no tokens, no cookie. */
export class ChallengeResponse {
  @ApiProperty({ type: String, enum: ['NEW_PASSWORD_REQUIRED'] })
  challenge!: 'NEW_PASSWORD_REQUIRED';

  @ApiProperty({
    type: String,
    description: 'Pass it to `POST /auth/complete-new-password`',
  })
  session!: string;
}

/**
 * Login, complete-new-password, provider-url and callback (design 7.2, 7.3).
 * Thin: validate, call Cognito (DD-11), admit, set the cookies. Every route
 * is public (FR-10); the three that take credentials or a code are throttled
 * (NFR-4). The interceptor records every failure; only a successful login
 * sends `Set-Cookie` (FR-9). Bodies are JSON only: `requireJsonPost` refuses
 * any other POST before it gets here (FR-4).
 */
@ApiTags('auth')
@ApiExtraModels(SessionResponse, ChallengeResponse)
@Public()
@UseInterceptors(AuthDecisionInterceptor)
@Controller('auth')
export class AuthController {
  private readonly allowedOrigins: readonly string[];

  constructor(
    @Inject(CognitoAuthClient)
    private readonly client: CognitoAuthClient,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
    @Inject(authConfig.KEY) config: ConfigType<typeof authConfig>,
  ) {
    this.allowedOrigins = config.allowedOrigins;
  }

  @ApiOperation({
    summary: 'Log in with email and password (custom users)',
    description:
      'Public, throttled. On success returns the session and sets the httpOnly session cookies (`qa_rt`, `qa_ru`). On a first login Cognito asks for a new password: the answer is the challenge, with no tokens and no cookies.',
  })
  @ApiOkResponse({
    description: 'A session, or the NEW_PASSWORD_REQUIRED challenge',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(SessionResponse) },
        { $ref: getSchemaPath(ChallengeResponse) },
      ],
    },
  })
  @ApiErrorResponses(400, 401, 403, 409, 415, 429, 503)
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

  @ApiOperation({
    summary: 'Complete the first-login NEW_PASSWORD_REQUIRED challenge',
    description: 'Public, throttled. Sets the session cookies on success.',
  })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrorResponses(400, 401, 403, 409, 415, 429, 503)
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

  @ApiOperation({
    summary: 'SSO step 1: the Cognito Hosted UI URL for CGIAR-AzureAD',
    description:
      'Public. Redirect the browser to `url`; after the Microsoft login the Hosted UI returns to `redirectUri?code=…`, then call `POST /auth/callback`.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', format: 'uri' } },
    },
  })
  @ApiErrorResponses(400)
  @Get('provider-url')
  async providerUrl(
    @Query() query: ProviderUrlQuery,
    @Req() request: RequestWithId,
  ): Promise<{ url: string }> {
    assertAllowedRedirectUri(query.redirectUri, this.allowedOrigins);
    // Built locally from the Hosted UI domain (DD-11): nothing upstream can fail.
    const url = await this.client.providerUrl(query.redirectUri);
    logAuthDecision(request, {
      outcome: 'ok',
      status: 200,
      reason: 'provider_url_issued',
    });
    return { url };
  }

  @ApiOperation({
    summary: 'SSO step 2: exchange the Hosted UI code for a session',
    description:
      'Public, throttled. The code is single use and short-lived. Sets the session cookies on success; a first SSO login creates a GUEST user.',
  })
  @ApiOkResponse({ type: SessionResponse })
  @ApiErrorResponses(400, 401, 403, 409, 415, 429, 503)
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
   * FR-8 and FR-9 for tokens Cognito just issued. Nothing reaches the
   * response before every check has passed, and the cookies are set last.
   */
  private async issueSession(
    request: RequestWithId,
    response: Response,
    tokens: CognitoTokens,
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
