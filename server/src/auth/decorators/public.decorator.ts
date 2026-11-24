import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/**
 * Opts a route (or every route of a controller) out of both global guards.
 * Only the routes listed in FR-10 use it: login, complete-new-password,
 * provider-url, callback, session refresh, session logout and health.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
