import type { IncomingMessage } from 'node:http';
import { parse } from 'content-type';
import type { NextFunction, Request, Response } from 'express';
import type { RequestWithId } from '../common/request-id.js';
import { decisionOfError, logAuthDecision } from './auth-decision.js';
import { UnsupportedMediaTypeError } from './auth.errors.js';

// FR-4 (login CSRF). A cross-site page can POST a form, a multipart body or a
// text/plain body (whose text may well be JSON) without a CORS preflight; it
// cannot POST `application/json` without one, and the CORS allow-list refuses
// that preflight. So under /api/v1/auth only JSON is ever read (design 7.2).

const JSON_MEDIA_TYPE = 'application/json';
const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';
const ZERO_LENGTH = /^0+$/;

/** No `Transfer-Encoding`, and no `Content-Length` or a zero one. */
function announcesNoBody({ headers }: IncomingMessage): boolean {
  const length = headers['content-length'];
  return (
    headers['transfer-encoding'] === undefined &&
    (length === undefined || ZERO_LENGTH.test(length))
  );
}

/**
 * Whether a POST passes the JSON-only rule. The `Content-Type` header is
 * parsed with `content-type`, the parser the body parsers themselves use: the
 * media type must be exactly `application/json` (lower-cased by the parser, so
 * compared case-insensitively), parameters such as `; charset=utf-8` allowed.
 * Without a `Content-Type`, only a POST with no body passes (the session
 * refresh and logout calls, T-9).
 */
export function isJsonOrBodyless(request: IncomingMessage): boolean {
  const header = request.headers['content-type'];
  return header === undefined
    ? announcesNoBody(request)
    : parse(header).type === JSON_MEDIA_TYPE;
}

/**
 * Mounted on /api/v1/auth ahead of the body parsers: a POST that fails the
 * JSON-only rule is answered 415 (error envelope, decision line, no cookie)
 * before its body is read and before any guard, handler or microservice call.
 * Other methods pass; no urlencoded or text parser runs there anyway.
 */
export function requireJsonPost(
  request: RequestWithId,
  _response: Response,
  next: NextFunction,
): void {
  if (request.method !== 'POST' || isJsonOrBodyless(request)) {
    next();
    return;
  }
  const error = new UnsupportedMediaTypeError();
  logAuthDecision(request, decisionOfError(error));
  next(error);
}

/**
 * Whether `path` is `base` or lies below it, matched as the router matches a
 * mount path: case-insensitively, segment by segment, trailing slash allowed.
 */
export function isUnderPath(path: string, base: string): boolean {
  const target = path.toLowerCase();
  const prefix = base.toLowerCase();
  return target === prefix || target.startsWith(`${prefix}/`);
}

/**
 * The urlencoded parser's `type` option: a form body is parsed on every path
 * but those under `base`. Called with the Express request, so `path` and
 * `is()` (the type check the parser would make by default) are there.
 */
export function formsOutside(base: string) {
  return (request: IncomingMessage): boolean => {
    const { path } = request as Request;
    return (
      !isUnderPath(path, base) &&
      Boolean((request as Request).is(FORM_MEDIA_TYPE))
    );
  };
}
