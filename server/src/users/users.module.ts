import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { catalogsConfig } from '../config/catalogs.config.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { CatalogService } from './catalogs/catalog.service.js';
import { CatalogsController } from './catalogs/catalogs.controller.js';
import {
  CATALOG_CLOCK,
  RESULT_TYPE_SOURCE,
  SCIENCE_PROGRAM_SOURCE,
} from './catalogs/catalogs.ports.js';
import { ClarisaScienceProgramsClient } from './catalogs/clarisa-science-programs.client.js';
import { ReportingResultTypesClient } from './catalogs/reporting-result-types.client.js';
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
  imports: [DrizzleModule, ConfigModule.forFeature(catalogsConfig)],
  controllers: [CatalogsController],
  providers: [
    { provide: USERS_STORE, useClass: DrizzleUsersStore },
    { provide: ROLE_ASSIGNMENTS_STORE, useClass: DrizzleRoleAssignmentsStore },
    UsersRepository,
    RoleAssignmentsRepository,
    AuthorizationService,
    { provide: CURRENT_USER_CLOCK, useValue: () => Date.now() },
    CurrentUserCache,
    { provide: RESULT_TYPE_SOURCE, useClass: ReportingResultTypesClient },
    { provide: SCIENCE_PROGRAM_SOURCE, useClass: ClarisaScienceProgramsClient },
    { provide: CATALOG_CLOCK, useValue: () => Date.now() },
    CatalogService,
  ],
  exports: [
    UsersRepository,
    RoleAssignmentsRepository,
    AuthorizationService,
    CurrentUserCache,
    CatalogService,
  ],
})
export class UsersModule {}
