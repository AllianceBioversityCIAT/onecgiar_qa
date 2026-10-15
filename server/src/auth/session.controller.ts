import {
  type CallHandler,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, throwError, type Observable } from 'rxjs';
import type { RequestWithId } from '../common/request-id.js';
import { AdmissionService } from './admission.service.js';
import { decisionOfError, logAuthDecision } from './auth-decision.js';
import type { SessionResponse } from './auth.controller.js';
import { SessionMissingError } from './auth.errors.js';
import { CognitoAuthClient } from './cognito-auth.client.js';
import { Public } from './decorators/public.decorator.js';
import { OriginGuard } from './guards/origin.guard.js';
import { toUserProfile } from './me.controller.js';
import {
  clearSessionCookies,
  REFRESH_COOKIE,
  setSessionCookies,
  USERNAME_COOKIE,
} from './session-cookies.js';
import { TokenVerifier } from './token-verifier.service.js';

const cookieOf = (request: Request, name: string): string | undefined => {
  const value = (request.cookies as Record<string, unknown> | undefined)?.[
    name
  ];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Logs every failed session call and, on any refusal (4xx: 401, 403, 409),
 * clears both session cookies (FR-13, design 7.3). A 5xx keeps them: Cognito being down must not end
 * the session (NFR-6). The OriginGuard refuses before this runs, so a foreign
 * origin never clears anything (FR-14).
 */
@Injectable()
export class SessionDecisionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        const decision = decisionOfError(error);
        if (
          error instanceof HttpException &&
          decision.status >= 400 &&
          decision.status < 500
        ) {
          clearSessionCookies(response);
        }
        logAuthDecision(request, decision);
        return throwError(() => error);
      }),
    );
  }
}

/**
 * Session refresh and logout (FR-13, FR-14, design 7.3). Public: the session
 * cookies are the credential, and the Origin check stands in for the CSRF
 * defense a Bearer token would give. The cookies reach only these routes
 * (Path `/api/v1/auth/session`, DD-3).
 */
@Public()
@UseGuards(OriginGuard)
@UseInterceptors(SessionDecisionInterceptor)
@Controller('auth/session')
export class SessionController {
  constructor(
    @Inject(CognitoAuthClient) private readonly client: CognitoAuthClient,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
  ) {}

  /**
   * FR-13: a new access token from the refresh cookies alone. Admission is
   * re-checked against the database (mode `refresh`, never the cache).
   */
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const refreshToken = cookieOf(request, REFRESH_COOKIE);
    const username = cookieOf(request, USERNAME_COOKIE);
    if (refreshToken === undefined || username === undefined) {
      throw new SessionMissingError();
    }

    const tokens = await this.client.refresh(refreshToken, username);
    const access = await this.verifier.verifyAccess(tokens.accessToken);
    const { user } = await this.admission.resolve(tokens.idToken, {
      mode: 'refresh',
    });

    // Rotated only when Cognito sent a new refresh token (it does not today:
    // design P-18); the username is the one Cognito just accepted.
    if (tokens.refreshToken !== undefined) {
      setSessionCookies(response, tokens.refreshToken, username);
    }
    logAuthDecision(request, {
      outcome: 'ok',
      status: 200,
      reason: 'session_refreshed',
      userId: user.id,
    });
    return {
      accessToken: tokens.accessToken,
      expiresIn: Math.max(0, access.exp - Math.floor(Date.now() / 1000)),
      user: toUserProfile(user),
    };
  }

  /**
   * FR-14: revokes the refresh token at Cognito, best effort, and clears both
   * cookies. Works with or without an access token.
   */
  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = cookieOf(request, REFRESH_COOKIE);
    let reason = 'logged_out';
    if (refreshToken !== undefined) {
      try {
        await this.client.revoke(refreshToken);
      } catch {
        // The client already logged why; the cookies go anyway.
        reason = 'logged_out_revoke_failed';
      }
    }
    clearSessionCookies(response);
    logAuthDecision(request, { outcome: 'ok', status: 204, reason });
  }
}
