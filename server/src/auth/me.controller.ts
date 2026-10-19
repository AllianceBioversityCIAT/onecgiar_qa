import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { Controller, Get } from '@nestjs/common';
import {
  type AdmittedUser,
  type AuthenticatedUser,
  isLiveAssignment,
} from '../users/current-user.cache.js';
import type { AuthSource } from '../database/drizzle/schema/users.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ReadAccess } from './decorators/read-access.decorator.js';

export class ProfileAssignment {
  @ApiProperty({ type: String, example: 'ASSESSOR', description: 'Role code' })
  role!: string;

  @ApiPropertyOptional({
    type: String,
    example: 'innovation_development',
    description: 'Set for result-type-scoped roles',
  })
  resultTypeKey?: string;

  @ApiPropertyOptional({
    type: Number,
    example: 12,
    description: 'Set for program-scoped roles',
  })
  programId?: number;
}

/** The `user` shape of the API (design section 6). */
export class UserProfile {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, example: 'ada@cgiar.org' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Ada' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Lovelace' })
  lastName!: string | null;

  @ApiProperty({ type: String, enum: ['sso', 'custom'], example: 'sso' })
  authSource!: AuthSource;

  @ApiProperty({
    type: [ProfileAssignment],
    description: 'Active assignments only; empty for a GUEST',
  })
  assignments!: ProfileAssignment[];
}

export function toUserProfile(user: AdmittedUser): UserProfile {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    authSource: user.authSource,
    assignments: user.assignments
      .filter(isLiveAssignment)
      .map((assignment) => ({
        role: assignment.roleCode,
        ...(assignment.resultTypeKey === null
          ? {}
          : { resultTypeKey: assignment.resultTypeKey }),
        ...(assignment.programId === null
          ? {}
          : { programId: assignment.programId }),
      })),
  };
}

/** FR-15: the authenticated user's profile and active assignments, GUEST included. */
@ApiTags('auth')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@Controller('auth')
export class MeController {
  @ApiOperation({
    summary: 'The authenticated user and their active role assignments',
    description: 'Any authenticated user, GUEST included.',
  })
  @ApiOkEnvelope(UserProfile)
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
  })
  @ReadAccess()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): UserProfile {
    return toUserProfile(user);
  }
}
