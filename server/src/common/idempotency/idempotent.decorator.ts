import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Opt-in per route (DD-6): runs the route through `IdempotencyInterceptor`.
 * Needs `IDEMPOTENCY_STORE`, `IDEMPOTENCY_CLOCK` and
 * `IDEMPOTENCY_REPLAY_READER` resolvable in the module of the controller.
 * Guards still run first, so a 401/403 never reserves a key (P-1, FR-6).
 */
export const Idempotent = () =>
  applyDecorators(UseInterceptors(IdempotencyInterceptor));
