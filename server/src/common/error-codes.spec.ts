import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  EmailCollisionError,
  EmailNotVerifiedError,
  NoActiveRolesError,
  OriginNotAllowedError,
  RedirectUriNotAllowedError,
  SessionMissingError,
  UnsupportedMediaTypeError,
  UserInactiveError,
  UserNotRegisteredError,
  UsernameClaimMissingError,
} from '../auth/auth.errors.js';
import {
  InvalidCredentialsError,
  PasswordPolicyError,
  UpstreamUnavailableError,
} from '../auth/cognito-auth.client.js';
import { UserNotAdmittedError } from '../auth/guards/auth.guard.js';
import { PermissionDeniedError } from '../auth/guards/permission.guard.js';
import { InvalidTokenError } from '../auth/token-verifier.service.js';
import {
  CycleActivationBusyError,
  CycleClosedError,
  CycleNotDraftError,
  CycleNotFoundError,
  CycleYearTakenError,
  TimelineAssignmentNotFoundError,
  TimelineInProgressUnconfirmedError,
  TimelineNameTakenError,
  TimelineNotFoundError,
  TimelineUserNotEligibleError,
  TimelineValidationError,
  TimelineVersionStaleError,
} from '../admin-config/admin-config.errors.js';
import {
  IdempotencyFenceLostError,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
} from './idempotency/idempotency.errors.js';
import {
  AssignmentNotFoundError,
  DuplicateActiveAssignmentError,
  DuplicateUserError,
  InvalidEmailError,
  ScopeMismatchError,
  UnknownRoleError,
} from '../users/users.errors.js';
import {
  ERROR_CATALOG,
  ERROR_CODES,
  FIELD_ERRORS,
  genericCodeFor,
  isErrorCode,
} from './error-codes.js';

// Words that would mean internals leaked into user copy.
const TECHNICAL =
  /cognito|sql|drizzle|mysql|exception|stack|undefined|null|class-validator|nestjs|\bsub\b|token_use|errno|[{}<>]/i;

describe('error catalog', () => {
  it.each(ERROR_CODES)('%s has user-facing copy and a valid status', (code) => {
    const { status, message } = ERROR_CATALOG[code];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    expect(message).toMatch(/^[A-Z].*\.$/);
    expect(message).not.toMatch(TECHNICAL);
    expect(code).toMatch(/^[A-Z][A-Z_]+$/);
  });

  it('keeps the login refusal free of any hint about the account', () => {
    expect(ERROR_CATALOG.AUTH_INVALID_CREDENTIALS.message).toBe(
      'Incorrect email or password.',
    );
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'BAD_REQUEST'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('maps a bare %i to %s', (status, code) => {
    expect(genericCodeFor(status)).toBe(code);
  });

  it('recognises only catalog codes', () => {
    expect(isErrorCode('AUTH_USER_NOT_REGISTERED')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('Invalid credentials')).toBe(false);
    expect(isErrorCode(403)).toBe(false);
  });
});

describe('domain errors declare a catalog code with the same status', () => {
  const errors: Array<[string, HttpException]> = [
    ['EmailCollisionError', new EmailCollisionError()],
    ['EmailNotVerifiedError', new EmailNotVerifiedError()],
    ['UserNotRegisteredError', new UserNotRegisteredError()],
    ['UserInactiveError', new UserInactiveError()],
    ['NoActiveRolesError', new NoActiveRolesError()],
    ['UsernameClaimMissingError', new UsernameClaimMissingError()],
    ['RedirectUriNotAllowedError', new RedirectUriNotAllowedError()],
    ['UnsupportedMediaTypeError', new UnsupportedMediaTypeError()],
    ['OriginNotAllowedError', new OriginNotAllowedError()],
    ['SessionMissingError', new SessionMissingError()],
    ['InvalidCredentialsError', new InvalidCredentialsError()],
    [
      'InvalidCredentialsError(session)',
      new InvalidCredentialsError('AUTH_SESSION_EXPIRED'),
    ],
    ['PasswordPolicyError', new PasswordPolicyError()],
    ['UpstreamUnavailableError', new UpstreamUnavailableError()],
    ['InvalidTokenError', new InvalidTokenError()],
    ['UserNotAdmittedError', new UserNotAdmittedError()],
    ['PermissionDeniedError', new PermissionDeniedError()],
    ['ScopeMismatchError', new ScopeMismatchError('detail')],
    ['UnknownRoleError', new UnknownRoleError('NOPE')],
    ['DuplicateActiveAssignmentError', new DuplicateActiveAssignmentError()],
    ['AssignmentNotFoundError', new AssignmentNotFoundError(7)],
    ['InvalidEmailError', new InvalidEmailError()],
    ['DuplicateUserError', new DuplicateUserError()],
    ['IdempotencyKeyReusedError', new IdempotencyKeyReusedError()],
    ['IdempotencyInProgressError', new IdempotencyInProgressError()],
    ['IdempotencyFenceLostError', new IdempotencyFenceLostError()],
    ['CycleNotFoundError', new CycleNotFoundError(1)],
    ['CycleYearTakenError', new CycleYearTakenError()],
    ['CycleNotDraftError', new CycleNotDraftError()],
    ['CycleActivationBusyError', new CycleActivationBusyError()],
    ['CycleClosedError', new CycleClosedError()],
    ['TimelineNotFoundError', new TimelineNotFoundError(1)],
    ['TimelineNameTakenError', new TimelineNameTakenError()],
    ['TimelineUserNotEligibleError', new TimelineUserNotEligibleError('x')],
    ['TimelineVersionStaleError', new TimelineVersionStaleError()],
    [
      'TimelineInProgressUnconfirmedError',
      new TimelineInProgressUnconfirmedError(),
    ],
    ['TimelineAssignmentNotFoundError', new TimelineAssignmentNotFoundError(1)],
    [
      'TimelineValidationError',
      new TimelineValidationError([{ field: 'name', code: 'REQUIRED' }]),
    ],
  ];

  it.each(errors)('%s', (_name, error) => {
    const { code } = error.getResponse() as { code?: unknown };
    expect(isErrorCode(code), String(code)).toBe(true);
    expect(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].status).toBe(
      error.getStatus(),
    );
  });
});

describe('idempotency errors (users-admin-write-safety FR-4, FR-5)', () => {
  it.each([
    [new IdempotencyKeyReusedError(), 422, 'IDEMPOTENCY_KEY_REUSED'],
    [new IdempotencyInProgressError(), 409, 'IDEMPOTENCY_IN_PROGRESS'],
    // A stalled first request that lost the key answers like any in-flight key.
    [new IdempotencyFenceLostError(), 409, 'IDEMPOTENCY_IN_PROGRESS'],
  ])('%s answers %i %s', (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect((error.getResponse() as { code: string }).code).toBe(code);
    expect(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].status).toBe(
      status,
    );
  });
});

describe('cycle and timeline errors (cycle-timelines FR-11, DD-8)', () => {
  it.each([
    [new CycleNotFoundError(1), 404, 'CYCLES_NOT_FOUND'],
    [new CycleYearTakenError(), 409, 'CYCLES_YEAR_TAKEN'],
    [new CycleNotDraftError(), 409, 'CYCLES_NOT_DRAFT'],
    [new CycleActivationBusyError(), 503, 'SERVICE_UNAVAILABLE'],
    [new CycleClosedError(), 409, 'CYCLES_CLOSED'],
    [new TimelineNotFoundError(1), 404, 'TIMELINES_NOT_FOUND'],
    [new TimelineNameTakenError(), 409, 'TIMELINES_NAME_TAKEN'],
    [new TimelineUserNotEligibleError('x'), 409, 'TIMELINES_USER_NOT_ELIGIBLE'],
    [new TimelineVersionStaleError(), 409, 'TIMELINES_VERSION_STALE'],
    [
      new TimelineInProgressUnconfirmedError(),
      409,
      'TIMELINES_IN_PROGRESS_UNCONFIRMED',
    ],
    [
      new TimelineAssignmentNotFoundError(1),
      404,
      'TIMELINES_ASSIGNMENT_NOT_FOUND',
    ],
  ])('%s answers %i %s', (error, status, code) => {
    expect(error.getStatus()).toBe(status);
    expect((error.getResponse() as { code: string }).code).toBe(code);
  });

  it('lists every field with a catalog field code and its message', () => {
    const error = new TimelineValidationError([
      { field: 'steps[0].opensOn', code: 'BEFORE_TODAY' },
      { field: 'steps[1].closesOn', code: 'CLOSES_BEFORE_OPENS' },
      { field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' },
      { field: 'steps[2].audience', code: 'AUDIENCE_ORDER' },
      { field: 'steps[2].round', code: 'ROUND_SEQUENCE' },
      { field: 'steps[0].requiresLoad', code: 'FIRST_STEP_LOAD' },
      { field: 'steps', code: 'OUT_OF_RANGE' },
    ]);
    expect(error.getStatus()).toBe(400);
    const body = error.getResponse() as {
      code: string;
      fields: Array<{ field: string; code: string; message: string }>;
    };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields.map((f) => f.code)).toEqual([
      'BEFORE_TODAY',
      'CLOSES_BEFORE_OPENS',
      'OVERLAPS_PREVIOUS_STEP',
      'AUDIENCE_ORDER',
      'ROUND_SEQUENCE',
      'FIRST_STEP_LOAD',
      'OUT_OF_RANGE',
    ]);
    for (const f of body.fields) expect(f.message).toMatch(/^[A-Z].*\.$/);
  });

  it('says a locked field can no longer be changed (timeline-edit FR-3)', () => {
    const error = new TimelineValidationError([
      { field: 'steps[0].closesOn', code: 'LOCKED' },
    ]);
    const body = error.getResponse() as {
      fields: Array<{ field: string; code: string; message: string }>;
    };
    expect(body.fields).toEqual([
      {
        field: 'steps[0].closesOn',
        code: 'LOCKED',
        message: 'This can no longer be changed.',
      },
    ]);
  });

  it('answers the stale and the unconfirmed edit with the user-facing texts (timeline-edit § 6)', () => {
    expect(new TimelineVersionStaleError().getResponse()).toEqual({
      code: 'TIMELINES_VERSION_STALE',
      message:
        'Someone else changed this timeline. Reload it and make your change again.',
    });
    expect(new TimelineInProgressUnconfirmedError().getResponse()).toEqual({
      code: 'TIMELINES_IN_PROGRESS_UNCONFIRMED',
      message:
        'This change affects a step that is in progress. Confirm it to save.',
    });
  });

  it('has exactly the eight new field codes beside the six existing ones', () => {
    expect(Object.keys(FIELD_ERRORS).sort()).toEqual(
      [
        'REQUIRED',
        'INVALID_TYPE',
        'INVALID_EMAIL',
        'TOO_LONG',
        'UNKNOWN_FIELD',
        'INVALID',
        'OUT_OF_RANGE',
        'CLOSES_BEFORE_OPENS',
        'OVERLAPS_PREVIOUS_STEP',
        'BEFORE_TODAY',
        'AUDIENCE_ORDER',
        'ROUND_SEQUENCE',
        'FIRST_STEP_LOAD',
        'LOCKED',
      ].sort(),
    );
  });
});
