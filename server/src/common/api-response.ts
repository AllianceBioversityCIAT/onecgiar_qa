import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  type ErrorCode,
  FIELD_ERRORS,
  type FieldErrorCode,
} from './error-codes.js';

/*
 * The response standard of every endpoint.
 *
 *   success: { success: true,  data,  meta }
 *   error:   { success: false, error, meta }
 *
 * `meta.requestId` is also sent as the `x-request-id` header; quote it to
 * support. A 204 has no body. Success bodies are wrapped by
 * `ResponseEnvelopeInterceptor`, errors built by `HttpExceptionFilter`.
 */

export interface ApiPageMeta {
  /** Opaque; pass it back as `cursor` for the next page. `null` on the last page. */
  nextCursor: string | null;
}

export interface ApiMeta {
  requestId: string;
  /** ISO 8601, when the response was produced. */
  timestamp: string;
  /** Only on a paginated list. */
  page?: ApiPageMeta;
}

/**
 * What a list handler returns: the items become `data`, the cursor becomes
 * `meta.page.nextCursor` (TRD section 6, cursor pagination).
 */
export class Paged<T> {
  constructor(
    readonly items: readonly T[],
    readonly nextCursor: string | null,
  ) {}
}

export interface ApiFieldError {
  /** The request field, dotted for nested ones (`address.city`). */
  field: string;
  code: FieldErrorCode;
  message: string;
}

export interface ApiErrorBody {
  status: number;
  code: ErrorCode;
  message: string;
  /** Only for `VALIDATION_FAILED`. */
  fields?: ApiFieldError[];
  /** Only for 429: seconds to wait before retrying. */
  retryAfter?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

export const metaFor = (requestId: string): ApiMeta => ({
  requestId,
  timestamp: new Date().toISOString(),
});

// --- OpenAPI models ----------------------------------------------------------

export class ApiMetaModel implements ApiMeta {
  @ApiProperty({
    type: String,
    description:
      'Request id; also in the `x-request-id` header. Quote it to support',
    example: '3f2c1d1e-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  })
  requestId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-15T14:16:19.000Z',
  })
  timestamp!: string;
}

export class ApiPageMetaModel implements ApiPageMeta {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque; pass it back as `cursor` for the next page. null on the last page',
    example: 'eyJuIjoiQWRhIiwiaSI6MX0',
  })
  nextCursor!: string | null;
}

export class ApiFieldErrorModel implements ApiFieldError {
  @ApiProperty({ type: String, example: 'email' })
  field!: string;

  @ApiProperty({
    type: String,
    enum: Object.keys(FIELD_ERRORS),
    example: 'INVALID_EMAIL',
  })
  code!: FieldErrorCode;

  @ApiProperty({ type: String, example: 'Enter a valid email address.' })
  message!: string;
}

export class ApiErrorBodyModel implements ApiErrorBody {
  @ApiProperty({ type: Number, example: 403 })
  status!: number;

  @ApiProperty({
    type: String,
    enum: ERROR_CODES,
    description: 'Stable code: branch on it',
    example: 'AUTH_USER_NOT_REGISTERED',
  })
  code!: ErrorCode;

  @ApiProperty({
    type: String,
    description: 'Safe to show to the user as is',
    example: ERROR_CATALOG.AUTH_USER_NOT_REGISTERED.message,
  })
  message!: string;

  @ApiPropertyOptional({
    type: [ApiFieldErrorModel],
    description: 'Per-field problems, only for VALIDATION_FAILED',
  })
  fields?: ApiFieldError[];

  @ApiPropertyOptional({
    type: Number,
    description: 'Seconds to wait, only for 429',
    example: 60,
  })
  retryAfter?: number;
}

export class ApiErrorResponseModel implements ApiFailure {
  @ApiProperty({ type: Boolean, enum: [false] })
  success!: false;

  @ApiProperty({ type: ApiErrorBodyModel })
  error!: ApiErrorBody;

  @ApiProperty({ type: ApiMetaModel })
  meta!: ApiMeta;
}

export class ApiPagedMetaModel extends ApiMetaModel {
  @ApiProperty({ type: ApiPageMetaModel })
  page!: ApiPageMeta;
}

type DataSchema = Type<unknown> | Record<string, unknown>;

const dataSchemaOf = (data: DataSchema) =>
  typeof data === 'function' ? { $ref: getSchemaPath(data) } : data;

/**
 * Documents a 2xx answer wrapped in `{ success: true, data, meta }`. `data` is
 * a model class or an inline schema (e.g. a `oneOf`). `status` is 200 unless
 * the route answers 201; `paged` adds `meta.page` for a cursor-paginated list.
 */
export const ApiOkEnvelope = (
  data: DataSchema,
  options: {
    description?: string;
    extraModels?: Type<unknown>[];
    status?: 200 | 201;
    paged?: boolean;
  } = {},
) =>
  applyDecorators(
    ApiExtraModels(
      ApiMetaModel,
      ApiPagedMetaModel,
      ...(typeof data === 'function' ? [data] : []),
      ...(options.extraModels ?? []),
    ),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: dataSchemaOf(data),
          meta: {
            $ref: getSchemaPath(
              options.paged ? ApiPagedMetaModel : ApiMetaModel,
            ),
          },
        },
      },
    }),
  );

/**
 * Documents the error answers of a route, by status, with the codes the route
 * can return: `@ApiErrorResponses({ 401: ['AUTH_INVALID_CREDENTIALS'] })`. The
 * description lists each code with its message, so the front knows exactly
 * what to expect.
 */
export const ApiErrorResponses = (byStatus: Record<number, ErrorCode[]>) =>
  applyDecorators(
    ...Object.entries(byStatus).map(([status, codes]) =>
      ApiResponse({
        status: Number(status),
        description: codes
          .map((code) => `\`${code}\` — ${ERROR_CATALOG[code].message}`)
          .join('<br>'),
        type: ApiErrorResponseModel,
      }),
    ),
  );
