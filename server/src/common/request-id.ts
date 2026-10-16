import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** The request after `requestIdMiddleware`. */
export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * The client's `x-request-id` when it matches `[A-Za-z0-9._-]{1,64}`,
 * otherwise a fresh UUID v4.
 */
function newRequestId(request: Request): string {
  const supplied = request.headers[REQUEST_ID_HEADER];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}

/**
 * Gives every request its id before anything else runs, so the guards, the
 * handlers, the logs and the error filter all see the same one (NFR-7), and
 * returns it in the `x-request-id` response header, success or error.
 */
export function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  request.requestId = newRequestId(request);
  response.setHeader(REQUEST_ID_HEADER, request.requestId);
  next();
}

/** The id of this request; a request that skipped the middleware gets one now. */
export function requestIdOf(request: RequestWithId): string {
  request.requestId ??= newRequestId(request);
  return request.requestId;
}
