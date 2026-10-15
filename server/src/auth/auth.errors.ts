import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';

// Typed domain errors of admission (FR-8, TRD section 11). They extend the Nest
// HTTP exceptions so the global filter maps them without knowing this module.
// Step 1 (a token that fails verification) is the verifier's `InvalidTokenError`.

/** FR-8 step 3: the email belongs to a user with another Cognito `sub`. */
export class EmailCollisionError extends ConflictException {
  constructor() {
    super(errorBody('AUTH_EMAIL_CONFLICT'));
  }
}

/** FR-8 step 2: a custom token may link a pre-registered user by email only when that email is verified. */
export class EmailNotVerifiedError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_EMAIL_NOT_VERIFIED'));
  }
}

/** FR-8 step 4: no QA user, and this login may not create one. */
export class UserNotRegisteredError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_USER_NOT_REGISTERED'));
  }
}

/** FR-8 step 5. */
export class UserInactiveError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_USER_INACTIVE'));
  }
}

/** FR-8 step 6: a custom user with no live role assignment. */
export class NoActiveRolesError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_NO_ACTIVE_ROLES'));
  }
}

/**
 * The id token of an admitted login has no `cognito:username` (premise P-12,
 * UNVERIFIED until T-11): without it the refresh cookie cannot be written, so
 * the login is refused (FR-9, fail closed).
 */
export class UsernameClaimMissingError extends UnauthorizedException {
  constructor() {
    super(errorBody('AUTH_LOGIN_INCOMPLETE'));
  }
}

/** FR-6, FR-7: a redirect URI outside `ALLOWED_ORIGINS`; Cognito is never called. */
export class RedirectUriNotAllowedError extends BadRequestException {
  constructor() {
    super(errorBody('AUTH_REDIRECT_URI_NOT_ALLOWED'));
  }
}

/** FR-4 (login CSRF): a POST under /api/v1/auth whose media type is not JSON. */
export class UnsupportedMediaTypeError extends UnsupportedMediaTypeException {
  constructor() {
    super(errorBody('UNSUPPORTED_MEDIA_TYPE'));
  }
}

/** FR-13, FR-14: a session call from an origin outside `ALLOWED_ORIGINS` (or none). */
export class OriginNotAllowedError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_ORIGIN_NOT_ALLOWED'));
  }
}

/** FR-13: refresh without both session cookies. */
export class SessionMissingError extends UnauthorizedException {
  constructor() {
    super(errorBody('AUTH_SESSION_MISSING'));
  }
}
