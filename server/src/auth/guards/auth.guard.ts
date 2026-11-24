import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { errorBody } from '../../common/error-codes.js';
import { Reflector } from '@nestjs/core';
import {
  CurrentUserCache,
  isAdmitted,
} from '../../users/current-user.cache.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { InvalidTokenError, TokenVerifier } from '../token-verifier.service.js';

/** A valid token whose owner may no longer use QA (FR-11). */
export class UserNotAdmittedError extends UnauthorizedException {
  constructor() {
    super(errorBody('AUTH_USER_NOT_ADMITTED'));
  }
}

/**
 * First global guard (design 7.2). Skips `@Public()` routes; on every other
 * route it verifies the Bearer access token (FR-10), loads the current user
 * through the cache and refuses anyone not admitted (FR-11), then attaches
 * `request.user`. Every refusal is a 401 raised before the handler runs.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(CurrentUserCache) private readonly currentUsers: CurrentUserCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (token === undefined) throw new InvalidTokenError();

    const { sub } = await this.verifier.verifyAccess(token);
    const user = await this.currentUsers.getBySub(sub);
    if (!user || !isAdmitted(user)) throw new UserNotAdmittedError();

    request.user = user;
    return true;
  }
}

/** The token of `Authorization: Bearer <token>` (scheme is case-insensitive), or undefined. */
function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const parts = header.split(' ');
  if (parts.length !== 2) return undefined;
  const [scheme, token] = parts;
  return scheme.toLowerCase() === 'bearer' && token.length > 0
    ? token
    : undefined;
}
