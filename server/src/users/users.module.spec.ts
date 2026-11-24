import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import {
  IDEMPOTENCY_REPLAY_READER,
  type IdempotencyReplayReader,
} from '../common/idempotency/idempotency.interceptor.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_STORE,
  IDEMPOTENCY_TOKEN_FACTORY,
} from '../common/idempotency/idempotency.store.js';
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

  it('binds what the idempotency interceptor needs and leaves the token factory unbound', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideModule(DrizzleModule)
      .useModule(FakeDrizzleModule)
      .compile();

    expect(moduleRef.get(IDEMPOTENCY_STORE)).toBeInstanceOf(
      DrizzleIdempotencyStore,
    );
    expect(moduleRef.get(IDEMPOTENCY_CLOCK)()).toBeInstanceOf(Date);
    expect(
      moduleRef.get<IdempotencyReplayReader>(IDEMPOTENCY_REPLAY_READER),
    ).toHaveProperty('read');
    // Owner tokens come from randomUUID (T-3 pointer): nothing may bind a factory here.
    expect(() => moduleRef.get(IDEMPOTENCY_TOKEN_FACTORY)).toThrow();
    await moduleRef.close();
  });
});
