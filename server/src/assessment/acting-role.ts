// @akili-spec admin/acts-as-reviewer
import {
  applyDecorators,
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { errorBody, FIELD_ERRORS } from '../common/error-codes.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import type { RoleCode } from '../users/permissions.js';
import { enabledReviewerRows } from './role-steps.js';

// The QA Admin acting as a reviewer role (admin/acts-as-reviewer, R1). The
// role travels on every assessment request as the `X-Acting-Role` header. It
// is honored only for a caller with `ADMIN_ACCESS` (the service decides that,
// `resolveAccess`); any other caller's header is ignored. With no header an
// Admin stays read-only, as before (step-1 DD-2).

/** The request header that carries the role a QA Admin acts as. */
export const ACTING_ROLE_HEADER = 'X-Acting-Role';

/**
 * The roles an Admin may act as: the enabled reviewer rows of the role-step
 * table: ASSESSOR, LEAD_ASSESSOR, TPB (P2-3916) and PPU (P2-3917).
 */
export function actingRoleCodes(): readonly RoleCode[] {
  return enabledReviewerRows().map((row) => row.role);
}

/**
 * The header's role, or `undefined` when absent or blank. Any other value
 * (unknown, or a role whose row is disabled) is 400 `VALIDATION_FAILED` on
 * the header, for every caller: a typo must not silently read as read-only.
 */
export function parseActingRole(raw: unknown): RoleCode | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidActingRole();
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const role = actingRoleCodes().find((code) => code === trimmed);
  if (role === undefined) throw invalidActingRole();
  return role;
}

function invalidActingRole(): BadRequestException {
  return new BadRequestException({
    ...errorBody('VALIDATION_FAILED'),
    fields: [
      {
        field: ACTING_ROLE_HEADER,
        code: 'INVALID',
        message: FIELD_ERRORS.INVALID(),
      },
    ],
  });
}

/** The parsed `X-Acting-Role` header of the request (see `parseActingRole`). */
export const ActingRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RoleCode | undefined =>
    parseActingRole(
      context.switchToHttp().getRequest<Request>().headers[
        ACTING_ROLE_HEADER.toLowerCase()
      ],
    ),
);

/** Documents the optional `X-Acting-Role` header on an assessment route. */
export const ApiActingRole = () =>
  applyDecorators(
    ApiHeader({
      name: ACTING_ROLE_HEADER,
      required: false,
      description:
        "QA Admin only: the reviewer role to act as on this result (`ASSESSOR` on a round-1 result, `LEAD_ASSESSOR` on a round-2 one, `TPB` on a round-2 result the Lead escalated, `PPU` on one the TPB escalated). The Admin then reads and writes with that role's rules, whatever the step dates, and what it writes is marked as written by an Admin. Without it an Admin is read-only. Ignored for any other caller. Any other value is a 400 `VALIDATION_FAILED` naming the header.",
      schema: { type: 'string', enum: [...actingRoleCodes()] },
    }),
  );

/** The caller of an assessment route: the user, and the role an Admin acts as when the header names one. */
export type ReviewerCaller = AuthenticatedUser & {
  readonly actingRole?: RoleCode;
};

/** The user with the role it asked to act as; the user itself when none. */
export function asCaller(
  user: AuthenticatedUser,
  actingRole: RoleCode | undefined,
): ReviewerCaller {
  return actingRole === undefined ? user : { ...user, actingRole };
}
