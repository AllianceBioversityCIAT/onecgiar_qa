import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { AuthorizationService } from './authorization.service.js';
import { CurrentUserCache } from './current-user.cache.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UserAuditRepository } from './user-audit.repository.js';
import { UserProgramsRepository } from './user-programs.repository.js';
import {
  DrizzleUsersAdminUnitOfWork,
  USERS_ADMIN_UNIT_OF_WORK,
} from './users-admin.unit-of-work.js';
import { UsersModule } from './users.module.js';
import { UsersRepository } from './users.repository.js';

@Global()
@Module({
  providers: [{ provide: DRIZZLE, useValue: {} }],
  exports: [DRIZZLE],
})
class FakeDrizzleModule {}

describe('UsersModule wiring', () => {
  it('resolves and exports the repositories, the authorization service and the current-user cache', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideModule(DrizzleModule)
      .useModule(FakeDrizzleModule)
      .compile();

    expect(moduleRef.get(UsersRepository)).toBeInstanceOf(UsersRepository);
    expect(moduleRef.get(RoleAssignmentsRepository)).toBeInstanceOf(
      RoleAssignmentsRepository,
    );
    expect(moduleRef.get(AuthorizationService)).toBeInstanceOf(
      AuthorizationService,
    );
    expect(moduleRef.get(CurrentUserCache)).toBeInstanceOf(CurrentUserCache);
    await moduleRef.close();
  });

  it('wires the program scope repository and the admin unit of work, and keeps the audit repository inside the transaction', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideModule(DrizzleModule)
      .useModule(FakeDrizzleModule)
      .compile();

    expect(moduleRef.get(UserProgramsRepository)).toBeInstanceOf(
      UserProgramsRepository,
    );
    expect(moduleRef.get(USERS_ADMIN_UNIT_OF_WORK)).toBeInstanceOf(
      DrizzleUsersAdminUnitOfWork,
    );
    // An audit repository outside the unit of work could write an event with no change (FR-13).
    expect(() => moduleRef.get(UserAuditRepository)).toThrow();
    await moduleRef.close();
  });
});
