import type { ErrorCode } from '../error-codes.js';

/**
 * OpenAPI pieces of a keyed write (FR-10), kept beside the interceptor so the
 * contract and the behavior change together. `@Idempotent()` documents the
 * request header; a route passes `IDEMPOTENCY_REPLAYED_HEADERS` to its
 * `ApiOkEnvelope` and its error lists through `withIdempotencyErrors`.
 */

/** The request header, exactly as the interceptor validates it (FR-6). */
export const IDEMPOTENCY_KEY_HEADER_DOC = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Optional. Send the same value on every retry of one action: a repeat by the same admin returns the first answer and runs nothing (marked by `Idempotency-Replayed: true`). The same value with a different request is a 422, and one still running is a 409. 1 to 128 characters: letters, digits, `-`, `_`, `.`, `:`. Remembered for 24 hours.',
  schema: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9\\-_.:]+$',
  },
};

/** The marker on a replayed success answer (FR-3). */
export const IDEMPOTENCY_REPLAYED_HEADERS = {
  'Idempotency-Replayed': {
    description:
      '`true` when this answer is the remembered first answer of the same `Idempotency-Key`; the request did not run again. Absent otherwise.',
    schema: { type: 'string', enum: ['true'] },
  },
};

const merge = (own: ErrorCode[] | undefined, added: ErrorCode[]) => [
  ...(own ?? []),
  ...added.filter((code) => !own?.includes(code)),
];

/**
 * Adds the codes any keyed write can answer to a route's own list: a bad key
 * (400), a key in flight (409), a key reused for another request (422) and the
 * key store being down (503, NFR-4).
 */
export const withIdempotencyErrors = (
  own: Record<number, ErrorCode[]>,
): Record<number, ErrorCode[]> => ({
  ...own,
  400: merge(own[400], ['VALIDATION_FAILED']),
  409: merge(own[409], ['IDEMPOTENCY_IN_PROGRESS']),
  422: ['IDEMPOTENCY_KEY_REUSED'],
  503: merge(own[503], ['SERVICE_UNAVAILABLE']),
});
