import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export interface ErrorEnvelope {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
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
 * Maps every exception to the error envelope of TRD section 6:
 * `{ statusCode, error, message, details?, requestId }`.
 * Unknown errors become a 500 without internals.
 *
 * `requestId` is the client's `x-request-id` header when it matches
 * `[A-Za-z0-9._-]{1,64}`, otherwise a fresh UUID v4; it is also returned in
 * the `x-request-id` response header.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = resolveRequestId(request);

    const envelope = this.toEnvelope(exception, requestId);
    if (envelope.statusCode >= 500) {
      this.logger.error(
        JSON.stringify({
          event: 'unhandled_error',
          requestId,
          method: request.method,
          path: request.path,
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.setHeader('x-request-id', requestId);
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

    const { message, error: bodyError, details } = body as {
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

function resolveRequestId(request: Request): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}
