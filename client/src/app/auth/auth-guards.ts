import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthSession } from './auth-session';

export const LOGIN_PATH = '/login';
export const HOME_PATH = '/';

/** Protected pages: without a session, go to login carrying the requested path. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthSession).isSignedIn()) {
    return true;
  }
  const returnUrl = state.url === HOME_PATH ? undefined : state.url;
  return inject(Router).createUrlTree([LOGIN_PATH], {
    queryParams: returnUrl ? { returnUrl } : {},
  });
};

/** Login page: a signed-in user goes home. */
export const guestGuard: CanActivateFn = () =>
  inject(AuthSession).isSignedIn() ? inject(Router).parseUrl(HOME_PATH) : true;

/** Only internal paths are accepted as return targets (no open redirects). */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return HOME_PATH;
  }
  return value;
}
