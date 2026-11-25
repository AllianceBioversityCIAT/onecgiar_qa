// P2-3911: the guard of every `/sp` route.
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../../admin-config/admin-config.clock.js';
import { bearerToken } from '../../auth/guards/auth.guard.js';
import {
  SP_ACCESS_STORE,
  type SpAccessStore,
  type SpSessionPrincipal,
} from './sp-access.store.js';
import { SpSessionInvalidError } from './sp-view.errors.js';
import { sha256Hex } from './sp-tokens.js';

export interface SpSessionRequest extends Request {
  spSession?: SpSessionPrincipal;
}

/**
 * Reads `Authorization: Bearer <token>`, looks the session up by the token's
 * SHA-256 among the sessions still live at the clock's now, and attaches it
 * as `request.spSession`. Anything else (no header, another scheme, an unknown
 * or expired token, a Cognito JWT) is the same 401 `SP_SESSION_INVALID`. The
 * token is never logged.
 */
@Injectable()
export class SpSessionGuard implements CanActivate {
  constructor(
    @Inject(SP_ACCESS_STORE) private readonly store: SpAccessStore,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SpSessionRequest>();
    const token = bearerToken(request.headers.authorization);
    // A session token is 43 base64url characters; anything far longer is not one.
    if (token === undefined || token.length > 128) {
      throw new SpSessionInvalidError();
    }
    const session = await this.store.findLiveSession(
      sha256Hex(token),
      this.clock(),
    );
    if (session === null) throw new SpSessionInvalidError();
    request.spSession = session;
    return true;
  }
}
