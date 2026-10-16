import { Module } from '@nestjs/common';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { AuthorizationService } from './authorization.service.js';
import { CURRENT_USER_CLOCK, CurrentUserCache } from './current-user.cache.js';
import {
  DrizzleRoleAssignmentsStore,
  ROLE_ASSIGNMENTS_STORE,
  RoleAssignmentsRepository,
} from './role-assignments.repository.js';
import {
  DrizzleUsersStore,
  USERS_STORE,
  UsersRepository,
} from './users.repository.js';

/**
 * Users, role assignments and permission evaluation (design DD-1). Later
 * modules import this module for `AuthorizationService` and the repositories.
 */
@Module({
  imports: [DrizzleModule],
  providers: [
    { provide: USERS_STORE, useClass: DrizzleUsersStore },
    { provide: ROLE_ASSIGNMENTS_STORE, useClass: DrizzleRoleAssignmentsStore },
    UsersRepository,
    RoleAssignmentsRepository,
    AuthorizationService,
    { provide: CURRENT_USER_CLOCK, useValue: () => Date.now() },
    CurrentUserCache,
  ],
  exports: [
    UsersRepository,
    RoleAssignmentsRepository,
    AuthorizationService,
    CurrentUserCache,
  ],
})
export class UsersModule {}
