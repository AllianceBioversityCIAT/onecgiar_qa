import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { AuthSession } from './auth-session';
import { TokenStore } from './token-store';

/** Marks a request already retried after a refresh: never retried twice. */
const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

/**
 * Auth policy for calls to OUR API only (anything else passes untouched):
 * - `Authorization: Bearer <token>` when a token exists (never the PRMS custom `auth` header).
 * - `withCredentials` on `/auth/*`, so the browser sends/receives the httpOnly refresh cookie.
 * - A 401 outside the sign-in/session endpoints (e.g. `/auth/me`, any data call) triggers ONE
 *   shared refresh, then the call is retried once.
 *   If the refresh fails the session ends and the user goes to login (deep link kept).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBaseUrl = inject(APP_CONFIG).apiBaseUrl;
  if (!isApiUrl(req.url, apiBaseUrl)) return next(req);

  const tokens = inject(TokenStore);
  const session = inject(AuthSession);
  const cookies = isAuthUrl(req.url, apiBaseUrl);
  const refreshable = !isSessionFlowUrl(req.url, apiBaseUrl);

  const usedToken = tokens.accessToken();
  const prepared = withAuth(req, usedToken, cookies);
  return next(prepared).pipe(
    catchError((error: unknown) => {
      const retriable =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        refreshable &&
        !req.context.get(RETRIED_AFTER_REFRESH);
      if (!retriable) return throwError(() => error);

      const retryOnce = () => {
        const retry = req.clone({
          context: copyContext(req.context).set(RETRIED_AFTER_REFRESH, true),
        });
        return next(withAuth(retry, tokens.accessToken(), cookies)).pipe(
          catchError((retryError: unknown) => {
            // A fresh token is still refused (e.g. the user was deactivated): the session is over.
            if (retryError instanceof HttpErrorResponse && retryError.status === 401) {
              void session.expire();
            }
            return throwError(() => retryError);
          }),
        );
      };

      // Another call already renewed the token while this one was in flight: just retry.
      const current = tokens.accessToken();
      if (current && current !== usedToken) return retryOnce();

      return from(session.refresh()).pipe(
        switchMap((outcome) => {
          if (outcome === 'ended') void session.expire();
          if (outcome !== 'renewed') return throwError(() => error);
          return retryOnce();
        }),
      );
    }),
  );
};

/** Keeps the caller's context tokens on the retry without mutating the original request. */
function copyContext(source: HttpContext): HttpContext {
  const copy = new HttpContext();
  for (const token of source.keys()) copy.set(token, source.get(token));
  return copy;
}

function withAuth(
  req: HttpRequest<unknown>,
  token: string | null,
  cookies: boolean,
): HttpRequest<unknown> {
  return req.clone({
    ...(cookies ? { withCredentials: true } : {}),
    ...(token ? { setHeaders: { Authorization: `Bearer ${token}` } } : {}),
  });
}

/** Absolute base (`https://…/api/v1`) or same-origin relative base (`/api/v1`, dev mock). */
export function isApiUrl(url: string, apiBaseUrl: string): boolean {
  return url === apiBaseUrl || url.startsWith(`${apiBaseUrl}/`);
}

export function isAuthUrl(url: string, apiBaseUrl: string): boolean {
  return url.startsWith(`${apiBaseUrl}/auth/`);
}

/** Sign-in and session endpoints: their 401 is an answer, not an expired token. */
const SESSION_FLOW_PATHS = [
  '/auth/login',
  '/auth/complete-new-password',
  '/auth/provider-url',
  '/auth/callback',
  '/auth/session/',
];

export function isSessionFlowUrl(url: string, apiBaseUrl: string): boolean {
  return SESSION_FLOW_PATHS.some((path) => url.startsWith(`${apiBaseUrl}${path}`));
}
