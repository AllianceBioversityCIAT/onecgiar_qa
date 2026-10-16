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
  ];

  it.each(errors)('%s', (_name, error) => {
    const { code } = error.getResponse() as { code?: unknown };
    expect(isErrorCode(code), String(code)).toBe(true);
    expect(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].status).toBe(
      error.getStatus(),
    );
  });
});
