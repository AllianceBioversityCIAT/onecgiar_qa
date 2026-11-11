// @akili-spec assessment/step-1-assessment
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
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

/**
 * A write kept finding another pinned configuration version under the lock than
 * the one it judged by, even after its one retry: 503 `SERVICE_UNAVAILABLE`,
 * retryable, nothing committed. The pin is set once, on the row's creation, so
 * a second mismatch means the row changed under the request twice; the step is
 * not closed and the assessment not ended, so no 409 of this module fits. The
 * cause is the mismatch itself, never part of the answer.
 */
export class AssessmentBusyError extends ServiceUnavailableException {
  constructor(cause?: unknown) {
    super(errorBody('SERVICE_UNAVAILABLE'), { cause });
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
 * FR-15): the global filter forwards them as `error.fields`.
 */
export class AssessmentCoreUncommentedError extends ConflictException {
  constructor(readonly fields: string[]) {
    super({ ...errorBody('ASSESSMENT_CORE_UNCOMMENTED'), fields });
  }
}

/**
 * The quick comments of a role are for the users who hold a live grant of that
 * role (FR-12): any other caller, an ADMIN included, is refused.
 */
export class AssessmentQuickCommentsForbiddenError extends ForbiddenException {
  constructor() {
    super(errorBody('AUTH_PERMISSION_DENIED'));
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
 * A comment names a field that is not Assessed in the pinned configuration:
 * View only, Hidden or unknown (FR-11 *Comment on a non-assessed field*). A 400
 * `VALIDATION_FAILED` on `fieldKey`, the property; the key the caller sent is
 * not echoed back.
 */
export class AssessmentCommentFieldInvalidError extends BadRequestException {
  constructor() {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: [
        { field: 'fieldKey', code: 'INVALID', message: FIELD_ERRORS.INVALID() },
      ],
    });
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
