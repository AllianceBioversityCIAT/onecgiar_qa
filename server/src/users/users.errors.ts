import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';

// Typed domain errors of the users module (TRD section 11). They extend the
// Nest HTTP exceptions so the global filter maps them to the error envelope
// without knowing about this module.

export class ScopeMismatchError extends BadRequestException {
  /** Why the scope is wrong; for logs and tests, never sent to the client. */
  constructor(readonly detail: string) {
    super(errorBody('USERS_SCOPE_MISMATCH'));
  }
}

export class UnknownRoleError extends BadRequestException {
  constructor(readonly roleCode: string) {
    super(errorBody('USERS_UNKNOWN_ROLE'));
  }
}

export class DuplicateActiveAssignmentError extends ConflictException {
  constructor() {
    super(errorBody('USERS_DUPLICATE_ASSIGNMENT'));
  }
}

export class AssignmentNotFoundError extends NotFoundException {
  constructor(readonly assignmentId: number) {
    super(errorBody('USERS_ASSIGNMENT_NOT_FOUND'));
  }
}

export class InvalidEmailError extends BadRequestException {
  constructor() {
    super(errorBody('USERS_INVALID_EMAIL'));
  }
}

export class DuplicateUserError extends ConflictException {
  constructor() {
    super(errorBody('USERS_DUPLICATE_USER'));
  }
}

/**
 * True for a MySQL duplicate-key violation (ER_DUP_ENTRY / errno 1062),
 * whether the driver error is raised directly or wrapped as a `cause`.
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
