import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IDEMPOTENCY_KEY_HEADER_DOC } from './idempotency.openapi.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Opt-in per route (DD-6): runs the route through `IdempotencyInterceptor` and
 * documents the optional `Idempotency-Key` header (FR-10).
 * Needs `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK` and
 * `IDEMPOTENCY_REPLAY_READER` resolvable in the module of the controller.
 * Guards still run first, so a 401/403 never reserves a key (P-1, FR-6).
 */
export const Idempotent = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader(IDEMPOTENCY_KEY_HEADER_DOC),
  );
