import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  REQUEST_ID_HEADER,
  requestIdOf,
  type RequestWithId,
} from './request-id.js';

/** The body of every error response (TRD § 6). A class so OpenAPI can describe it. */
export class ErrorEnvelope {
  @ApiProperty({ type: Number, example: 401 })
  statusCode!: number;

  @ApiProperty({ type: String, example: 'Unauthorized' })
  error!: string;

  @ApiProperty({ type: String, example: 'Invalid credentials' })
  message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Validation detail (e.g. the list of invalid fields), when any',
  })
  details?: unknown;

  @ApiProperty({
    type: String,
    description: 'Request id, also echoed in the `x-request-id` header',
    example: '3f2c1d1e-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  })
  requestId!: string;
}

const STATUS_TEXT: Record<number, string> = Object.fromEntries(
  Object.entries(HttpStatus)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [
      value as number,
      name
        .toLowerCase()
        .split('_')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' '),
    ]),
);

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

/**
 * Maps every exception to the error envelope of TRD section 6:
 * `{ statusCode, error, message, details?, requestId }`.
 * Unknown errors become a 500 without internals.
 *
 * `requestId` is the one `requestIdMiddleware` gave the request (the client's
 * `x-request-id` when well-formed, otherwise a fresh UUID v4); it is also
 * returned in the `x-request-id` response header.
 *
 * Every 5xx is logged as one structured line of fixed fields (`errorFacts`):
 * never the error's message or stack, which can carry data (FR-9, NFR-7).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = requestIdOf(request);

    const envelope = this.toEnvelope(exception, requestId);
    if (envelope.statusCode >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'unhandled_error',
          requestId,
          method: request.method,
          path: request.path,
          status: envelope.statusCode,
          ...errorFacts(exception),
        }),
      );
    }

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(envelope.statusCode).json(envelope);
  }

  private toEnvelope(exception: unknown, requestId: string): ErrorEnvelope {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: STATUS_TEXT[HttpStatus.INTERNAL_SERVER_ERROR],
        message: 'Internal server error',
        requestId,
      };
    }

    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    const error = STATUS_TEXT[statusCode] ?? 'Error';

    if (typeof body === 'string') {
      return { statusCode, error, message: body, requestId };
    }

    const {
      message,
      error: bodyError,
      details,
    } = body as {
      message?: string | string[];
      error?: string;
      details?: unknown;
    };
    // ValidationPipe reports an array of messages: keep them as `details`.
    if (Array.isArray(message)) {
      return {
        statusCode,
        error: bodyError ?? error,
        message: 'Validation failed',
        details: message,
        requestId,
      };
    }
    return {
      statusCode,
      error: bodyError ?? error,
      message: message ?? exception.message,
      ...(details === undefined ? {} : { details }),
      requestId,
    };
  }
}
