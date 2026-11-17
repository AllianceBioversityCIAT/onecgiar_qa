// P2-3911: the machine key of `POST /sp-access/codes` (contract § 2).
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { requestIdOf, type RequestWithId } from '../../common/request-id.js';
import { spAccessConfig } from '../../config/sp-access.config.js';
import { logSpAccess } from './sp-log.js';
import { secretEquals } from './sp-tokens.js';
import {
  SpAccessDisabledError,
  SpAccessKeyInvalidError,
} from './sp-view.errors.js';

/**
 * No key configured → 503 `SP_ACCESS_DISABLED`; the `x-api-key` header
 * missing or different → 401 `SP_ACCESS_KEY_INVALID`. The comparison is in
 * constant time over the SHA-256 of both values. A refusal writes its one
 * `sp_access` line here, since a guard throws before the service runs; the key
 * is never logged.
 */
@Injectable()
export class SpApiKeyGuard implements CanActivate {
  constructor(
    @Inject(spAccessConfig.KEY)
    private readonly config: ConfigType<typeof spAccessConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const refuse = (error: SpAccessDisabledError | SpAccessKeyInvalidError) => {
      logSpAccess({
        action: 'issue',
        outcome: 'refused',
        reason: (error.getResponse() as { code: string }).code,
        requestId: requestIdOf(request),
      });
      throw error;
    };
    const expected = this.config.apiKey;
    if (expected === undefined) return refuse(new SpAccessDisabledError());
    const given = request.headers['x-api-key'];
    if (typeof given !== 'string' || !secretEquals(given, expected)) {
      return refuse(new SpAccessKeyInvalidError());
    }
    return true;
  }
}
