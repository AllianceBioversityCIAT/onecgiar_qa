import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../users/current-user.cache.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';

/**
 * The user `AuthGuard` attached to the request. Only meaningful on routes
 * that are not `@Public()`; anywhere else there is no user, and the answer is
 * 401 rather than an undefined that a handler could mistake for a user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException();
    return user;
  },
);
