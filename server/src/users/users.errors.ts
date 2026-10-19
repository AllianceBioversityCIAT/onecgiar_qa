import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { errorBody, FIELD_ERRORS } from '../common/error-codes.js';

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

/**
 * Assessor and Lead Assessor on one result type, `*` included (FR-3, DD-2,
 * DD-11). Which two grants clash stays in `detail`, for logs and tests only.
 */
export class RoleConflictError extends ConflictException {
  constructor(readonly detail: string) {
    super(errorBody('USERS_ROLE_CONFLICT'));
  }
}

export class AssignmentNotFoundError extends NotFoundException {
  constructor(readonly assignmentId: number) {
    super(errorBody('USERS_ASSIGNMENT_NOT_FOUND'));
  }
}

/** The target user of an admin change does not exist (design 7, step 1). */
export class UserNotFoundError extends NotFoundException {
  constructor(readonly userId: number) {
    super(errorBody('USERS_NOT_FOUND'));
  }
}

/** The change would leave no active ADMIN (FR-7, DD-3). */
export class LastAdminError extends ConflictException {
  constructor() {
    super(errorBody('USERS_LAST_ADMIN'));
  }
}

/** An active exclusion of this user and program already exists (DD-5). */
export class ExclusionExistsError extends ConflictException {
  constructor() {
    super(errorBody('USERS_EXCLUSION_EXISTS'));
  }
}

/** No active exclusion with this id for this user (ended rows count as absent). */
export class ExclusionNotFoundError extends NotFoundException {
  constructor(readonly exclusionId: number) {
    super(errorBody('USERS_EXCLUSION_NOT_FOUND'));
  }
}

export class ExclusionNotManualError extends ConflictException {
  constructor() {
    super(errorBody('USERS_EXCLUSION_NOT_MANUAL'));
  }
}

export class ExclusionNotReportingError extends ConflictException {
  constructor() {
    super(errorBody('USERS_EXCLUSION_NOT_REPORTING'));
  }
}

/** The `reason` of an exclusion is empty or too long (FR-4): a 400 on the `reason` field. */
export class ExclusionReasonError extends BadRequestException {
  constructor(code: 'REQUIRED' | 'TOO_LONG', max: number) {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: [{ field: 'reason', code, message: FIELD_ERRORS[code](max) }],
    });
  }
}

/** A program id that cannot be a CLARISA id (not a positive integer within the column). Whether it exists is the catalog's call (FR-4). */
export class InvalidProgramIdError extends BadRequestException {
  constructor() {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: [
        {
          field: 'programIds',
          code: 'INVALID',
          message: FIELD_ERRORS.INVALID(),
        },
      ],
    });
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
