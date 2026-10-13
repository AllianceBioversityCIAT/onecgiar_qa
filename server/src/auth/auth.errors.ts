import { ConflictException, ForbiddenException } from '@nestjs/common';

// Typed domain errors of admission (FR-8, TRD section 11). They extend the Nest
// HTTP exceptions so the global filter maps them without knowing this module.
// Step 1 (a token that fails verification) is the verifier's `InvalidTokenError`.

/** FR-8 step 3: the email belongs to a user with another Cognito `sub`. */
export class EmailCollisionError extends ConflictException {
  constructor() {
    super('This email belongs to another account');
  }
}

/** FR-8 step 2: a custom token may link a pre-registered user by email only when that email is verified. */
export class EmailNotVerifiedError extends ForbiddenException {
  constructor() {
    super('This email has not been verified');
  }
}

/** FR-8 step 4: no QA user, and this login may not create one. */
export class UserNotRegisteredError extends ForbiddenException {
  constructor() {
    super('This account is not registered');
  }
}

/** FR-8 step 5. */
export class UserInactiveError extends ForbiddenException {
  constructor() {
    super('This account is inactive');
  }
}

/** FR-8 step 6: a custom user with no live role assignment. */
export class NoActiveRolesError extends ForbiddenException {
  constructor() {
    super('This account has no active role');
  }
}
