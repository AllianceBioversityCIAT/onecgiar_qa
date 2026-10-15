import { Controller, Get } from '@nestjs/common';
import {
  type AuthenticatedUser,
  isLiveAssignment,
} from '../users/current-user.cache.js';
import type { AuthSource } from '../database/drizzle/schema/users.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ReadAccess } from './decorators/read-access.decorator.js';

export interface ProfileAssignment {
  role: string;
  resultTypeKey?: string;
  programId?: number;
}

/** The `user` shape of the API (design section 6). */
export interface UserProfile {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  authSource: AuthSource;
  assignments: ProfileAssignment[];
}

export function toUserProfile(user: AuthenticatedUser): UserProfile {
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
@Controller('auth')
export class MeController {
  @ReadAccess()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): UserProfile {
    return toUserProfile(user);
  }
}
