import { HttpContext, HttpContextToken, HttpRequest } from '@angular/common/http';

/** The caller shows its own error (e.g. login renders it inline): no toast. */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);

/** Milliseconds before an API call counts as "could not reach the server". */
export const TIMEOUT_MS = new HttpContextToken<number>(() => 20_000);

/** Set on a replay from the unsent queue: the queue handles its outcome, not the interceptor. */
export const QUEUE_REPLAY = new HttpContextToken<boolean>(() => false);

/** Short text the Unsent list shows for this write (defaults to method + path). */
export const UNSENT_LABEL = new HttpContextToken<string | null>(() => null);

export function silentErrors(context = new HttpContext()): HttpContext {
  return context.set(SILENT_ERRORS, true);
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWrite(req: HttpRequest<unknown>): boolean {
  return WRITE_METHODS.has(req.method);
}
