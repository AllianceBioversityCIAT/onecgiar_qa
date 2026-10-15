import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { type ApiErrorBody, type ApiFailure, metaFor } from './api-response.js';
import { ERROR_CATALOG, genericCodeFor, isErrorCode } from './error-codes.js';
import {
  REQUEST_ID_HEADER,
  requestIdOf,
  type RequestWithId,
} from './request-id.js';

/**
 * What the log line of a 5xx says about the error: fixed fields only, never
 * its message or its stack (FR-9, NFR-7). Both are untrusted text: drizzle-orm
 * writes a failed query's params into the message (`Failed query: …\nparams:
 * …`), a driver error quotes the values it choked on, and a stack starts with
 * the message, so any of them can carry a username, an email or a token. The
 * class says what failed; a driver error says why through its codes.
 */
interface ErrorFacts {
  /** The class of what was thrown, or its `typeof` when it is no object. */
  error: string;
  /** The class of its `cause`, when it has one. */
  cause?: string;
  /** Driver fields (mysql2, Node), the first well-formed one down the cause chain. */
  code?: string;
  errno?: number;
  sqlState?: string;
}

interface DriverFields {
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
}

// Each field is kept only when it has the shape of what it names, so no free
// text can pass through one of them.
const CLASS_NAME = /^[A-Za-z_$][\w$]{0,63}$/;
const DRIVER_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SQL_STATE = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 3;

const isObject = (value: unknown): value is DriverFields =>
  typeof value === 'object' && value !== null;

/**
 * The class name comes from the code. `name` does not: it is a writable
 * string (and drizzle-orm leaves it as `Error`), so it is not used.
 */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  const className = (
    Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null
  )?.constructor?.name;
  return typeof className === 'string' && CLASS_NAME.test(className)
    ? className
    : 'UnknownError';
}

export function errorFacts(exception: unknown): ErrorFacts {
  try {
    const facts: ErrorFacts = { error: kindOf(exception) };
    if (isObject(exception) && exception.cause !== undefined) {
      facts.cause = kindOf(exception.cause);
    }
    for (
      let current: unknown = exception, depth = 0;
      isObject(current) && depth < MAX_CAUSE_DEPTH;
      current = current.cause, depth++
    ) {
      const { code, errno, sqlState } = current;
      if (typeof code === 'string' && DRIVER_CODE.test(code)) {
        facts.code ??= code;
      }
      if (typeof errno === 'number' && Number.isSafeInteger(errno)) {
        facts.errno ??= errno;
      }
      if (typeof sqlState === 'string' && SQL_STATE.test(sqlState)) {
        facts.sqlState ??= sqlState;
      }
    }
    return facts;
  } catch {
    // A getter that throws must not cost the caller its response.
    return { error: 'UnknownError' };
  }
}

/** body-parser failures arrive as plain errors with a `type` (http-errors). */
const PARSER_ERRORS: Record<string, 'MALFORMED_JSON' | 'PAYLOAD_TOO_LARGE'> = {
  'entity.parse.failed': 'MALFORMED_JSON',
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
};

const parserCodeOf = (exception: unknown) => {
  const type = (exception as { type?: unknown } | null)?.type;
  return typeof type === 'string' ? PARSER_ERRORS[type] : undefined;
};

/**
 * Builds every error response of the API (response standard,
 * `api-response.ts`): `{ success: false, error: { status, code, message,
 * fields?, retryAfter? }, meta: { requestId, timestamp } }`.
 *
 * Only text from the error catalog (`error-codes.ts`) reaches the client: a
 * domain exception names its code (`errorBody(code)`); any other exception —
 * Nest's own, a driver error, a bug — gets the generic code of its status and
 * that code's message. An exception's own message, a validation text or a
 * database detail is never returned. `fields` comes from the validation
 * factory (`validation.ts`), already in our words.
 *
 * `requestId` is the one `requestIdMiddleware` gave the request, also sent in
 * the `x-request-id` header. Every 5xx is logged as one structured line of
 * fixed fields (`errorFacts`): never the error's message or stack, which can
 * carry data (FR-9, NFR-7).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = requestIdOf(request);

    const error = toErrorBody(exception, response);
    if (error.status >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'unhandled_error',
          requestId,
          method: request.method,
          path: request.path,
          status: error.status,
          responseCode: error.code,
          ...errorFacts(exception),
        }),
      );
    }

    const body: ApiFailure = {
      success: false,
      error,
      meta: metaFor(requestId),
    };
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(error.status).json(body);
  }
}

/** The `error` part of the response, from catalog text only. */
export function toErrorBody(
  exception: unknown,
  response?: Pick<Response, 'getHeader'>,
): ApiErrorBody {
  const parserCode = parserCodeOf(exception);
  if (parserCode !== undefined) {
    const { status, message } = ERROR_CATALOG[parserCode];
    return { status, code: parserCode, message };
  }
  if (!(exception instanceof HttpException)) {
    const { status, message } = ERROR_CATALOG.INTERNAL_ERROR;
    return { status, code: 'INTERNAL_ERROR', message };
  }

  const status = exception.getStatus();
  const body = exception.getResponse() as
    { code?: unknown; fields?: unknown } | string;
  const declared = typeof body === 'object' ? body.code : undefined;
  const code = isErrorCode(declared) ? declared : genericCodeFor(status);
  const error: ApiErrorBody = {
    status,
    code,
    message: ERROR_CATALOG[code].message,
  };
  if (
    code === 'VALIDATION_FAILED' &&
    typeof body === 'object' &&
    Array.isArray(body.fields)
  ) {
    error.fields = body.fields as ApiErrorBody['fields'];
  }
  if (status === 429) {
    const retryAfter = retryAfterOf(response);
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
  }
  return error;
}

/** Seconds from the throttler's `Retry-After` header (named throttlers suffix it). */
function retryAfterOf(
  response: Pick<Response, 'getHeader'> | undefined,
): number | undefined {
  if (response === undefined) return undefined;
  const headers = (response as Partial<Response>).getHeaderNames?.() ?? [
    'retry-after',
  ];
  for (const name of headers) {
    if (!name.toLowerCase().startsWith('retry-after')) continue;
    const seconds = Number(response.getHeader(name));
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  return undefined;
}
