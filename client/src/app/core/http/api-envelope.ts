import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';

/**
 * Standard API response of the QA server (`server/src/common/api-response.ts`).
 * Copied by hand until a shared package exists (TRD ADR-007): keep it in sync.
 */
export interface ApiMeta {
  readonly requestId: string;
  readonly timestamp: string;
}

export interface ApiFieldError {
  /** Payload key, e.g. `email`. */
  readonly field: string;
  /** `REQUIRED` | `INVALID_TYPE` | `INVALID_EMAIL` | `TOO_LONG` | `UNKNOWN_FIELD` | `INVALID`. */
  readonly code: string;
  readonly message: string;
}

export interface ApiErrorBody {
  readonly status: number;
  /** Closed catalog (`server/src/common/error-codes.ts`): branch on this, never on the text. */
  readonly code: string;
  /** Catalog text written for users: safe to show as is. */
  readonly message: string;
  readonly fields?: readonly ApiFieldError[];
  /** Seconds to wait, only on 429. */
  readonly retryAfter?: number;
}

export type ApiEnvelope<T> =
  | { readonly success: true; readonly data: T; readonly meta: ApiMeta }
  | { readonly success: false; readonly error: ApiErrorBody; readonly meta: ApiMeta };

/** Codes the front creates itself when the server gave no envelope. */
export const CLIENT_ERROR = {
  NETWORK: 'CLIENT_NETWORK_ERROR',
  UNEXPECTED_RESPONSE: 'CLIENT_UNEXPECTED_RESPONSE',
} as const;

const NETWORK_MESSAGE = 'We could not reach the QA service. Check your connection and try again.';
const UNEXPECTED_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';

/** The only error type the UI handles for API calls. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: readonly ApiFieldError[];
  readonly retryAfter: number | null;
  readonly requestId: string | null;

  constructor(body: ApiErrorBody, requestId: string | null = null) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.status;
    this.code = body.code;
    this.fields = body.fields ?? [];
    this.retryAfter = body.retryAfter ?? null;
    this.requestId = requestId;
  }

  /** Message for one form field, if the server sent one. */
  fieldMessage(field: string): string | null {
    return this.fields.find((f) => f.field === field)?.message ?? null;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { success?: unknown }).success === 'boolean'
  );
}

/** Turns any HTTP failure into an `ApiError` (envelope, network, or unknown shape). */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }
  if (error instanceof HttpErrorResponse) {
    const requestId = error.headers?.get('x-request-id') ?? null;
    if (isEnvelope(error.error) && !error.error.success) {
      return new ApiError(error.error.error, error.error.meta?.requestId ?? requestId);
    }
    if (error.status === 0) {
      return new ApiError(
        { status: 0, code: CLIENT_ERROR.NETWORK, message: NETWORK_MESSAGE },
        requestId,
      );
    }
    return new ApiError(
      { status: error.status, code: CLIENT_ERROR.UNEXPECTED_RESPONSE, message: UNEXPECTED_MESSAGE },
      requestId,
    );
  }
  return new ApiError({
    status: 0,
    code: CLIENT_ERROR.UNEXPECTED_RESPONSE,
    message: UNEXPECTED_MESSAGE,
  });
}

/**
 * Unwraps `data` from a successful envelope. A `null` body (204) gives `undefined`.
 * Every failure, including a 200 with `success: false`, becomes an `ApiError`.
 */
export function unwrap<T>() {
  return (source: Observable<ApiEnvelope<T> | null>): Observable<T> =>
    source.pipe(
      map((body) => {
        if (body === null) {
          return undefined as T;
        }
        if (!isEnvelope(body)) {
          throw new ApiError({
            status: 200,
            code: CLIENT_ERROR.UNEXPECTED_RESPONSE,
            message: UNEXPECTED_MESSAGE,
          });
        }
        if (!body.success) {
          throw new ApiError(body.error, body.meta?.requestId ?? null);
        }
        return body.data;
      }),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
}
