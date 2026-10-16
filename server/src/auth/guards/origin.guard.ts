import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { RequestWithId } from '../../common/request-id.js';
import { authConfig } from '../../config/auth.config.js';
import { logAuthDecision } from '../auth-decision.js';
import { OriginNotAllowedError } from '../auth.errors.js';

/**
 * On the session routes (design 7.2): the `Origin` header must be one of
 * `ALLOWED_ORIGINS`, exactly, else 403 before any work (FR-13, FR-14). A
 * missing `Origin` is refused too. Guards run before interceptors, so the
 * decision is logged here, and the session cookies are left untouched: a
 * foreign site must not be able to end a session.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: readonly string[];

  constructor(@Inject(authConfig.KEY) config: ConfigType<typeof authConfig>) {
    this.allowedOrigins = config.allowedOrigins;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const origin = request.headers.origin;
    if (typeof origin === 'string' && this.allowedOrigins.includes(origin)) {
      return true;
    }
    logAuthDecision(request, {
      outcome: 'refused',
      status: 403,
      reason: 'origin_not_allowed',
    });
    throw new OriginNotAllowedError();
  }
}
