import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { idempotencyKeyHeaderDoc } from './idempotency.openapi.js';
import {
  IDEMPOTENCY_KEY_REQUIRED,
  IdempotencyInterceptor,
} from './idempotency.interceptor.js';

export interface IdempotentOptions {
  /**
   * `true`: a request without `Idempotency-Key` is a 400 `VALIDATION_FAILED`
   * on the header and nothing runs or is reserved (P2-4128). Default `false`:
   * the header stays optional (FR-10).
   */
  required?: boolean;
}

/**
 * Opt-in per route (DD-6): runs the route through `IdempotencyInterceptor` and
 * documents the `Idempotency-Key` header (FR-10), optional unless
 * `{ required: true }`.
 * Needs `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK` and
 * `IDEMPOTENCY_REPLAY_READER` resolvable in the module of the controller.
 * Guards still run first, so a 401/403 never reserves a key (P-1, FR-6) and a
 * missing required header never hides them.
 */
export const Idempotent = ({ required = false }: IdempotentOptions = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENCY_KEY_REQUIRED, required),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader(idempotencyKeyHeaderDoc(required)),
  );
