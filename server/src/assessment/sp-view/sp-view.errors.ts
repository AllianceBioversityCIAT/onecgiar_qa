// P2-3911 (SP view): typed refusals of the SP routes. Every text comes from the
// catalog (`common/error-codes.ts`); kept out of `assessment.errors.ts` so the
// `ASSESSMENT_*` front-contract check is unchanged.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { errorBody } from '../../common/error-codes.js';

/** No `SP_ACCESS_API_KEY` is configured in this environment. */
export class SpAccessDisabledError extends ServiceUnavailableException {
  constructor() {
    super(errorBody('SP_ACCESS_DISABLED'));
  }
}

/** The `x-api-key` header is missing or wrong. */
export class SpAccessKeyInvalidError extends UnauthorizedException {
  constructor() {
    super(errorBody('SP_ACCESS_KEY_INVALID'));
  }
}

/** `programCode` is not a Science Program of the catalog (or null for a non-admin). */
export class SpProgramUnknownError extends BadRequestException {
  constructor() {
    super(errorBody('SP_PROGRAM_UNKNOWN'));
  }
}

/** The code is unknown, used, or expired: one identical answer for the three. */
export class SpCodeInvalidError extends UnauthorizedException {
  constructor() {
    super(errorBody('SP_CODE_INVALID'));
  }
}

/** No live SP session for the bearer (missing, unknown, expired, or a Cognito token). */
export class SpSessionInvalidError extends UnauthorizedException {
  constructor() {
    super(errorBody('SP_SESSION_INVALID'));
  }
}

/** Missing, or outside the session's program scope: the same body for both. */
export class SpNotFoundError extends NotFoundException {
  constructor() {
    super(errorBody('SP_NOT_FOUND'));
  }
}

/** The programs step is not in progress now. */
export class SpStepClosedError extends ConflictException {
  constructor() {
    super(errorBody('SP_STEP_CLOSED'));
  }
}

/** The comment's state accepts no program response. */
export class SpCommentNotRespondableError extends ConflictException {
  constructor() {
    super(errorBody('SP_COMMENT_NOT_RESPONDABLE'));
  }
}

/** The comment has no clarification request waiting for the assessor. */
export class ClarificationNotPendingError extends ConflictException {
  constructor() {
    super(errorBody('CLARIFICATION_NOT_PENDING'));
  }
}
