import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { errorBody } from '../../common/error-codes.js';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../../users/permissions.js';
import { AuthorizationService } from '../../users/authorization.service.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { READ_ACCESS_KEY } from '../decorators/read-access.decorator.js';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator.js';

/** The user is authenticated but no live assignment grants this route (FR-12). */
export class PermissionDeniedError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_PERMISSION_DENIED'));
  }
}

/**
 * Second global guard (design 7.2). Skips `@Public()` routes. A declared
 * `@RequirePermission(p)` needs `canAny(user, p)`; otherwise `@ReadAccess()`
 * lets any authenticated user in; a route declaring neither is refused
 * (FR-12, DD-5: fail closed). Resource scope is checked later, in services,
 * with `can()` (DD-4).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(
        IS_PUBLIC_KEY,
        targets,
      ) === true
    ) {
      return true;
    }

    // AuthGuard runs first and always sets the user; if it did not, deny.
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException();

    // A declared permission is stricter than the read marker, so it is
    // checked first and the marker only counts when no permission is declared.
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRE_PERMISSION_KEY,
      targets,
    );
    if (permission !== undefined) {
      if (this.authorization.canAny(user, permission)) return true;
      throw new PermissionDeniedError();
    }

    const readAccess = this.reflector.getAllAndOverride<boolean | undefined>(
      READ_ACCESS_KEY,
      targets,
    );
    if (readAccess === true) return true;

    throw new PermissionDeniedError();
  }
}
