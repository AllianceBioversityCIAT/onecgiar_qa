import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injector, Service, inject } from '@angular/core';
import { Observable, catchError, finalize, share, tap, throwError, timeout } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { isApiUrl, isAuthUrl } from '../auth/auth.interceptor';
import { APP_CONFIG } from '../config/app-config';
import { toApiError } from './api-envelope';
import { NO_QUEUE, QUEUE_REPLAY, SILENT_ERRORS, TIMEOUT_MS, isWrite } from './request-context';
import { Toasts } from './toasts';
import { IDEMPOTENCY_HEADER, UnsentQueue, actionSignature, isRetryLater, newId } from './unsent-queue';

/** Identical writes still in flight, shared so a second click never sends a second request. */
@Service()
export class InFlightWrites {
  readonly calls = new Map<string, Observable<HttpEvent<unknown>>>();
}

/**
 * The one chokepoint every call to OUR API goes through (registered before `authInterceptor`, so it
 * sees the outcome after a token refresh). Nothing here is done per screen:
 * - timeout: no eternal spinner; a silent server counts as "could not reach it";
 * - double submit: an identical write already in flight is shared, not sent again;
 * - `Idempotency-Key` on every write, so the server can drop a repeat (replays keep the same key);
 * - a write that could not reach the server (no answer, timeout, 502/503/504, or a 401 whose token
 *   refresh could not reach the server while the session is still alive) goes to the unsent queue;
 * - saving again something already in the queue reuses its key, and drops the stored copy on success;
 * - any other unhandled error shows one toast with the catalog message, unless the request is
 *   silent, is an auth call (login renders its own errors), is a 401 (the session handles it) or
 *   is a 422 with field errors (the form shows them).
 */
export const requestSafetyInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBaseUrl = inject(APP_CONFIG).apiBaseUrl;
  if (!isApiUrl(req.url, apiBaseUrl)) return next(req);

  const toasts = inject(Toasts);
  const inFlight = inject(InFlightWrites).calls;
  // Lazy: the queue depends on the session, which itself makes HTTP calls at startup.
  const injector = inject(Injector);
  const write = isWrite(req);
  const auth = isAuthUrl(req.url, apiBaseUrl);
  const replay = req.context.get(QUEUE_REPLAY);

  const key = write ? actionSignature(req.method, req.urlWithParams, req.body) : null;
  const shared = key ? inFlight.get(key) : undefined;
  if (shared) return shared;

  const queue = () => injector.get(UnsentQueue);
  const tracked = write && !auth && !replay && !req.context.get(NO_QUEUE);
  const prepared =
    write && !req.headers.has(IDEMPOTENCY_HEADER)
      ? req.clone({ setHeaders: { [IDEMPOTENCY_HEADER]: (tracked && queue().keyFor(key)) || newId() } })
      : req;

  const call = next(prepared).pipe(
    tap((event) => {
      if (tracked && event instanceof HttpResponse) queue().confirmedElsewhere(key);
    }),
    timeout({ each: req.context.get(TIMEOUT_MS), with: () => throwError(() => timedOut(req)) }),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || replay) return throwError(() => error);
      const lostRefresh = error.status === 401 && injector.get(AuthSession).isSignedIn();
      if (tracked && (isRetryLater(error.status, toApiError(error).code) || lostRefresh)) {
        queue().offer(prepared);
      } else if (shouldToast(error, req, auth)) {
        toasts.error(toApiError(error).message);
      }
      return throwError(() => error);
    }),
  );
  if (!key) return call;

  const once = call.pipe(
    finalize(() => inFlight.delete(key)),
    share(),
  );
  inFlight.set(key, once);
  return once;
};

function shouldToast(error: HttpErrorResponse, req: HttpRequest<unknown>, auth: boolean): boolean {
  if (auth || req.context.get(SILENT_ERRORS) || error.status === 401) return false;
  const fields = toApiError(error).fields;
  return !(error.status === 422 && fields.length > 0) && !(error.status === 400 && fields.length > 0);
}

function timedOut(req: HttpRequest<unknown>): HttpErrorResponse {
  return new HttpErrorResponse({ status: 0, statusText: 'Timeout', url: req.urlWithParams });
}
