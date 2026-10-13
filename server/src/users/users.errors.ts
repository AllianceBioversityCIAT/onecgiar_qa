import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// Typed domain errors of the users module (TRD section 11). They extend the
// Nest HTTP exceptions so the global filter maps them to the error envelope
// without knowing about this module.

export class ScopeMismatchError extends BadRequestException {
  constructor(detail: string) {
    super(`Assignment scope does not match its role: ${detail}`);
  }
}

export class UnknownRoleError extends BadRequestException {
  constructor(code: string) {
    super(`Unknown role "${code}"`);
  }
}

export class DuplicateActiveAssignmentError extends ConflictException {
  constructor() {
    super('The user already has this active assignment');
  }
}

export class AssignmentNotFoundError extends NotFoundException {
  constructor(id: number) {
    super(`No active assignment with id ${id}`);
  }
}

export class InvalidEmailError extends BadRequestException {
  constructor() {
    super('A valid email address is required');
  }
}

export class DuplicateUserError extends ConflictException {
  constructor() {
    super('A user with this email or Cognito sub already exists');
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
