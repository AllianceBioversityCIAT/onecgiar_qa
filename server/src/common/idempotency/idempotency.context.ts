import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Reservation } from './idempotency.store.js';

/**
 * What a keyed request carries from the interceptor to the handler (design 7,
 * Exactly-once fence). The users-admin controller reads it with
 * `@CurrentIdempotency()`, puts `reservation` into `AdminContext` and the
 * service passes it to `markExecuted(reservation, targetUserId)` inside the
 * business transaction. A request without the header has no handle, so the
 * service marks nothing (FR-1).
 */
export interface IdempotencyHandle {
  /** The fence token holder; every later write on the key is conditioned on it. */
  reservation: Reservation;
  /**
   * The value of the `idempotency=` field of the decision line (design 7,
   * Decision log): `taken_over` when this request took the key over from a
   * dead one, `none` for a plain first execution.
   */
  outcome: 'none' | 'taken_over';
}

// Keyed by the request object so nothing is added to the Express request type
// and a handle can never leak from one request to another.
const handles = new WeakMap<object, IdempotencyHandle>();

export function setIdempotencyHandle(
  request: object,
  handle: IdempotencyHandle,
): void {
  handles.set(request, handle);
}

export function idempotencyHandleOf(
  request: object,
): IdempotencyHandle | undefined {
  return handles.get(request);
}

/** `@CurrentIdempotency()` — the handle of a keyed request, `undefined` without the header. */
export const CurrentIdempotency = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    idempotencyHandleOf(context.switchToHttp().getRequest<object>()),
);
