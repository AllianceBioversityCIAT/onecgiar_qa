import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSession } from './auth-session';
import { DeepLink, HOME_PATH, LOGIN_PATH } from './deep-link';

/** Protected pages: waits for the startup refresh, then sends anonymous users to login (deep link kept). */
// Every inject() happens BEFORE the first await: after it there is no injection context.
export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(AuthSession);
  const deepLink = inject(DeepLink);
  const router = inject(Router);
  await session.ready();
  if (session.isSignedIn()) return true;
  deepLink.save(state.url);
  return router.parseUrl(LOGIN_PATH);
};

/** Login page: a signed-in user goes home (or to the pending deep link). */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(AuthSession);
  const deepLink = inject(DeepLink);
  const router = inject(Router);
  await session.ready();
  return session.isSignedIn() ? router.parseUrl(deepLink.consume() || HOME_PATH) : true;
};
