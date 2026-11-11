// @akili-spec assessment/step-1-assessment
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { errorBody, FIELD_ERRORS } from '../common/error-codes.js';

// Typed refusals of the assessment routes (FR-25, design 6). Like the loads
// errors they extend the Nest HTTP exceptions, so the global filter maps them
// to the error envelope, and every text comes from the catalog.
// `TIMELINES_NOT_FOUND` is reused (`TimelineNotFoundError`).

/** No such membership in this timeline, or it is outside the caller's rows. */
export class AssessmentNotFoundError extends NotFoundException {
  constructor() {
    super(errorBody('ASSESSMENT_NOT_FOUND'));
  }
}

/** The caller has no writer row for this result (an admin, for example). */
export class AssessmentReadOnlyError extends ForbiddenException {
  constructor() {
    super(errorBody('ASSESSMENT_READ_ONLY'));
  }
}

/** The role's step is not open now. */
export class AssessmentStepClosedError extends ConflictException {
  constructor() {
    super(errorBody('ASSESSMENT_STEP_CLOSED'));
  }
}

/** The assessment already ended; its status is no longer pending. */
export class AssessmentFinishedError extends ConflictException {
  constructor() {
    super(errorBody('ASSESSMENT_FINISHED'));
  }
}

/** The timeline resolves to no field configuration for the result's type. */
export class AssessmentNoFieldConfigError extends ConflictException {
  constructor() {
    super(errorBody('ASSESSMENT_NO_FIELD_CONFIG'));
  }
}

/**
 * Finish refused: grey core fields without a non-withdrawn comment. `fields`
 * are the uncommented core keys, carried for the 409 response details (design 6,
 * FR-15). The global filter forwards them in the response body once the finish
 * route (T-11) wires it; until then the catalog text alone is answered.
 */
export class AssessmentCoreUncommentedError extends ConflictException {
  constructor(readonly fields: string[]) {
    super(errorBody('ASSESSMENT_CORE_UNCOMMENTED'));
  }
}

/** Withdraw refused: the caller did not write the comment. */
export class AssessmentNotCommentAuthorError extends ForbiddenException {
  constructor() {
    super(errorBody('ASSESSMENT_NOT_COMMENT_AUTHOR'));
  }
}

/** Withdraw refused: the comment is no longer open. */
export class AssessmentCommentNotOpenError extends ConflictException {
  constructor() {
    super(errorBody('ASSESSMENT_COMMENT_NOT_OPEN'));
  }
}

/**
 * A validation request names a field that is not Assessed in the pinned
 * configuration: View only, Hidden or unknown (FR-10 *Check all skips other
 * fields*). A 400 `VALIDATION_FAILED` whose `fields` name each wrong key as the
 * client sent it, in the order sent.
 */
export class AssessmentFieldKeysInvalidError extends BadRequestException {
  constructor(readonly fieldKeys: readonly string[]) {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: fieldKeys.map((field) => ({
        field,
        code: 'INVALID',
        message: FIELD_ERRORS.INVALID(),
      })),
    });
  }
}
