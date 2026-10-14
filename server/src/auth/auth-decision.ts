import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { requestIdOf, type RequestWithId } from '../common/request-id.js';
import { DuplicateUserError } from '../users/users.errors.js';
import {
  InvalidCredentialsError,
  UpstreamUnavailableError,
} from './auth-microservice.client.js';
import {
  EmailCollisionError,
  EmailNotVerifiedError,
  NoActiveRolesError,
  RedirectUriNotAllowedError,
  UnsupportedMediaTypeError,
  UserInactiveError,
  UserNotRegisteredError,
  UsernameClaimMissingError,
} from './auth.errors.js';
import { InvalidTokenError } from './token-verifier.service.js';

/** `ok` and `challenge`: served; `refused`: a 4xx; `error`: a 5xx. */
export type AuthOutcome = 'ok' | 'challenge' | 'refused' | 'error';

export interface AuthDecision {
  outcome: AuthOutcome;
  status: number;
  /** A stable machine code: why the decision went the way it did. */
  reason: string;
  /** Set only when the decision is about a known QA user. */
  userId?: number;
}

const logger = new Logger('AuthDecision');

/**
 * NFR-7: one structured line per auth decision. Only fixed fields go in: the
 * route, the outcome, a reason code, the user id when known and the request
 * id. No token, cookie, password, code, username or request body, ever.
 * Outside a route (a middleware mounted on a path), the route is the path the
 * request came in on, without its query.
 */
export function logAuthDecision(
  request: RequestWithId,
  { outcome, status, reason, userId }: AuthDecision,
): void {
  const line = JSON.stringify({
    event: 'auth_decision',
    route: `${request.method} ${request.route?.path ?? `${request.baseUrl}${request.path}`}`,
    outcome,
    status,
    reason,
    ...(userId === undefined ? {} : { userId }),
    requestId: requestIdOf(request),
  });
  if (outcome === 'error') logger.error(line);
  else if (outcome === 'refused') logger.warn(line);
  else logger.log(line);
}

type ErrorClass = abstract new (...args: never[]) => Error;

// Most specific first: `RedirectUriNotAllowedError` is a `BadRequestException`.
// A QA-side misconfiguration (CLARISA refusing the `auth` header, or no auth
// config for QA's client) is not told apart: the client folds every upstream
// 4xx into `InvalidCredentialsError` and logs only its status.
const REASONS: ReadonlyArray<readonly [ErrorClass, string]> = [
  [InvalidCredentialsError, 'invalid_credentials'],
  [UpstreamUnavailableError, 'upstream_unavailable'],
  [InvalidTokenError, 'invalid_token'],
  [UsernameClaimMissingError, 'username_claim_missing'],
  [EmailCollisionError, 'email_collision'],
  [DuplicateUserError, 'duplicate_user'],
  [EmailNotVerifiedError, 'email_not_verified'],
  [UserNotRegisteredError, 'user_not_registered'],
  [UserInactiveError, 'user_inactive'],
  [NoActiveRolesError, 'no_active_roles'],
  [RedirectUriNotAllowedError, 'redirect_uri_not_allowed'],
  [BadRequestException, 'invalid_request'],
  [UnsupportedMediaTypeError, 'unsupported_media_type'],
];

/** What an error thrown on an auth route means as a decision. */
export function decisionOfError(error: unknown): AuthDecision {
  if (!(error instanceof HttpException)) {
    return { outcome: 'error', status: 500, reason: 'internal_error' };
  }
  const status = error.getStatus();
  const reason =
    REASONS.find(([type]) => error instanceof type)?.[1] ?? `http_${status}`;
  return { outcome: status >= 500 ? 'error' : 'refused', status, reason };
}

/**
 * On the auth controllers: records the decision of every request that fails
 * (the controller records the ones that succeed, where it knows the user).
 * Interceptors wrap the pipes, so a failed validation is recorded too. A
 * failure never touches the session cookies: an existing one is neither
 * cleared nor replaced, only a successful login sends `Set-Cookie` (FR-9).
 */
@Injectable()
export class AuthDecisionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        logAuthDecision(request, decisionOfError(error));
        return throwError(() => error);
      }),
    );
  }
}
