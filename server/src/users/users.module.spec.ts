import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import { DrizzleModule } from '../database/drizzle/drizzle.module.js';
import { AuthorizationService } from './authorization.service.js';
import { RoleAssignmentsRepository } from './role-assignments.repository.js';
import { UsersModule } from './users.module.js';
import { UsersRepository } from './users.repository.js';

@Global()
@Module({
  providers: [{ provide: DRIZZLE, useValue: {} }],
  exports: [DRIZZLE],
})
class FakeDrizzleModule {}

describe('UsersModule wiring', () => {
  it('resolves and exports the repositories and the authorization service', async () => {
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
    await moduleRef.close();
  });
});
