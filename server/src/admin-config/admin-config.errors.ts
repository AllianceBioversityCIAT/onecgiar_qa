import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errorBody, FIELD_ERRORS } from '../common/error-codes.js';
import type { FieldIssue } from '../users/users.errors.js';

// Typed domain errors of cycles and timelines (design 7.5). Like the users
// errors, they extend the Nest HTTP exceptions so the global filter maps them
// to the error envelope; every text comes from the catalog.

export class CycleNotFoundError extends NotFoundException {
  constructor(readonly cycleId: number) {
    super(errorBody('CYCLES_NOT_FOUND'));
  }
}

export class CycleYearTakenError extends ConflictException {
  constructor() {
    super(errorBody('CYCLES_YEAR_TAKEN'));
  }
}

export class CycleNotDraftError extends ConflictException {
  constructor() {
    super(errorBody('CYCLES_NOT_DRAFT'));
  }
}

/**
 * Every attempt of an activation was refused by a concurrent one (design 7.3,
 * NFR-3): 503 `SERVICE_UNAVAILABLE`, retryable. Nothing was committed. The
 * last refusal travels as the `cause`; it is never part of the answer.
 */
export class CycleActivationBusyError extends ServiceUnavailableException {
  constructor(cause?: unknown) {
    super(errorBody('SERVICE_UNAVAILABLE'), { cause });
  }
}

export class CycleClosedError extends ConflictException {
  constructor() {
    super(errorBody('CYCLES_CLOSED'));
  }
}

export class TimelineNotFoundError extends NotFoundException {
  constructor(readonly timelineId: number) {
    super(errorBody('TIMELINES_NOT_FOUND'));
  }
}

export class TimelineNameTakenError extends ConflictException {
  constructor() {
    super(errorBody('TIMELINES_NAME_TAKEN'));
  }
}

/** An edit made on a version of the timeline that is no longer the stored one (timeline-edit FR-9). */
export class TimelineVersionStaleError extends ConflictException {
  constructor() {
    super(errorBody('TIMELINES_VERSION_STALE'));
  }
}

/** An edit that changes a step in progress, sent without the confirmation (timeline-edit FR-8). */
export class TimelineInProgressUnconfirmedError extends ConflictException {
  constructor() {
    super(errorBody('TIMELINES_IN_PROGRESS_UNCONFIRMED'));
  }
}

/** Why the user does not qualify stays in `detail`, for logs and tests only. */
export class TimelineUserNotEligibleError extends ConflictException {
  constructor(readonly detail: string) {
    super(errorBody('TIMELINES_USER_NOT_ELIGIBLE'));
  }
}

export class TimelineAssignmentNotFoundError extends NotFoundException {
  constructor(readonly assignmentId: number) {
    super(errorBody('TIMELINES_ASSIGNMENT_NOT_FOUND'));
  }
}

/**
 * A create request that breaks one or more timeline rules (FR-11, DD-7): one
 * 400 `VALIDATION_FAILED` listing every offending field, in the shape of the
 * users `FieldValidationError`.
 */
export class TimelineValidationError extends BadRequestException {
  constructor(readonly issues: readonly FieldIssue[]) {
    super({
      ...errorBody('VALIDATION_FAILED'),
      fields: issues.map(({ field, code, max }) => ({
        field,
        code,
        message: FIELD_ERRORS[code](max),
      })),
    });
  }
}
