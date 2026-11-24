import type { Request } from 'express';
import type { AuthenticatedUser } from '../users/current-user.cache.js';

/** The request after `AuthGuard`: `user` is set on every non-public route. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
