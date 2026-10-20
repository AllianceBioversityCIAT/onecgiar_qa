import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { errorBody } from '../error-codes.js';

// Typed errors of the idempotency store (users-admin-write-safety FR-4, FR-5).
// They extend the Nest HTTP exceptions so the global filter renders them from
// the catalog without knowing about this module.

/** FR-4: the same key came with a different request fingerprint. */
export class IdempotencyKeyReusedError extends UnprocessableEntityException {
  constructor() {
    super(errorBody('IDEMPOTENCY_KEY_REUSED'));
  }
}

/** FR-5: the key is in flight (its lease is valid) or lost a take-over race. */
export class IdempotencyInProgressError extends ConflictException {
  constructor() {
    super(errorBody('IDEMPOTENCY_IN_PROGRESS'));
  }
}

/**
 * DD-3 fence: `markExecuted` matched no row, so this request no longer owns
 * the key (its lease expired and another request took it over). Thrown inside
 * the unit of work so the change rolls back and a stalled first request can
 * never apply it after a take-over (FR-5, NFR-1). The client sees the same 409
 * as any in-flight key: another request holds it.
 */
export class IdempotencyFenceLostError extends IdempotencyInProgressError {}

/**
 * True for a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062),
 * whether the driver error is raised directly or wrapped as a `cause`
 * (Drizzle wraps driver errors). Deadlocks (1213) and every other error are
 * not duplicates. Kept here so `common/` never imports a feature module.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno } = current as Error & {
      code?: unknown;
      errno?: unknown;
    };
    if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
  }
  return false;
}
