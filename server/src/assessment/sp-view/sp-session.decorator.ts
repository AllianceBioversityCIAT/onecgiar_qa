// P2-3911: how a route opts into the SP session.
import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SP_SESSION_KEY } from '../../auth/decorators/sp-session.metadata.js';
import { SP_SESSION_SCHEME } from '../../common/openapi.js';
import type { SpSessionPrincipal } from './sp-access.store.js';
import { SpSessionGuard, type SpSessionRequest } from './sp-session.guard.js';

/**
 * Marks a route (or controller) as a Science Program route: both global
 * Cognito guards skip it (`SP_SESSION_KEY`), and `SpSessionGuard` requires a
 * live SP session instead. The metadata and the guard always come together, so
 * a route can never skip the global guards without being guarded.
 */
export const SpSession = () =>
  applyDecorators(
    SetMetadata(SP_SESSION_KEY, true),
    UseGuards(SpSessionGuard),
    ApiBearerAuth(SP_SESSION_SCHEME),
  );

/** The SP session `SpSessionGuard` attached to the request; 401 if none. */
export const CurrentSpSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SpSessionPrincipal => {
    const { spSession } = context.switchToHttp().getRequest<SpSessionRequest>();
    if (!spSession) throw new UnauthorizedException();
    return spSession;
  },
);
