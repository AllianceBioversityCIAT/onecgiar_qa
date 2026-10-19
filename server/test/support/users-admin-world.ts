import { vi } from 'vitest';
import type { CognitoAdminClient } from '../../src/auth/cognito-admin.client.js';
import type { User } from '../../src/database/drizzle/schema/users.js';
import type { CatalogService } from '../../src/users/catalogs/catalog.service.js';
import type { CurrentUserCache } from '../../src/users/current-user.cache.js';
import { ROLE_DEFINITIONS } from '../../src/users/permissions.js';
import { RoleAssignmentsRepository } from '../../src/users/role-assignments.repository.js';
import { UserProgramsRepository } from '../../src/users/user-programs.repository.js';
import type {
  UsersAdminRepositories,
  UsersAdminUnitOfWork,
} from '../../src/users/users-admin.unit-of-work.js';
import { UsersAdminService } from '../../src/users/users-admin.service.js';
import { UsersRepository } from '../../src/users/users.repository.js';
import {
  InMemoryDatabase,
  InMemoryUsersAdminUnitOfWork,
} from './in-memory-stores.js';

/** The result types and Science Programs the fake catalog serves. */
export const RESULT_TYPES = [
  { key: 'KP', name: 'Knowledge product' },
  { key: 'INNOVATION_DEV', name: 'Innovation development' },
  { key: 'POLICY', name: 'Policy change' },
];
export const PROGRAMS = [
  { id: 1, code: 'SP01', name: 'Breeding' },
  { id: 2, code: 'SP02', name: 'Multifunctional landscapes' },
  { id: 3, code: 'SP03', name: 'Climate action' },
];

/**
 * A recording unit of work: every transaction logs `tx:begin` and `tx:commit`
 * (or `tx:rollback`) into `calls`, and the repositories it hands out log the
 * calls whose ORDER the design fixes (the last-admin guard before any grant
 * insert, design 7 step 2 / T-4).
 */
export class RecordingUnitOfWork implements UsersAdminUnitOfWork {
  constructor(
    private readonly inner: UsersAdminUnitOfWork,
    private readonly calls: string[],
  ) {}

  async run<T>(
    work: (repositories: UsersAdminRepositories) => Promise<T>,
  ): Promise<T> {
    this.calls.push('tx:begin');
    try {
      const result = await this.inner.run((repositories) => {
        this.spy(repositories);
        return work(repositories);
      });
      this.calls.push('tx:commit');
      return result;
    } catch (error) {
      this.calls.push('tx:rollback');
      throw error;
    }
  }

  private spy({ admins, assignments }: UsersAdminRepositories): void {
    const guard = admins.assertAnotherAdminRemains.bind(admins);
    admins.assertAnotherAdminRemains = (userId) => {
      this.calls.push('guard');
      return guard(userId);
    };
    const create = assignments.create.bind(assignments);
    assignments.create = (input) => {
      this.calls.push(`grant:${input.roleCode}:${input.resultTypeKey ?? ''}`);
      return create(input);
    };
    const revoke = assignments.revoke.bind(assignments);
    assignments.revoke = (id, by) => {
      this.calls.push(`revoke:${id}`);
      return revoke(id, by);
    };
  }
}

export interface SeedUser {
  email: string;
  authSource?: User['authSource'];
  nickname?: string;
  firstName?: string;
  lastName?: string;
  lastLoginAt?: Date | null;
  isActive?: boolean;
  invitation?: User['invitation'];
  /** `[role, resultTypeKey?]`; `'*'` is "all result types". */
  roles?: Array<[string, string?]>;
}

/** The whole user-management world over the in-memory database, with every edge a spy. */
export function adminWorld() {
  const db = new InMemoryDatabase();
  for (const role of ROLE_DEFINITIONS) {
    db.stores.assignments.addRole({
      code: role.code,
      name: role.name,
      scopeType: role.scopeType,
      isActive: true,
    });
  }
  const calls: string[] = [];
  const users = new UsersRepository(db.stores.users);
  const assignments = new RoleAssignmentsRepository(db.stores.assignments);
  const programs = new UserProgramsRepository(db.stores.programs);

  const cognito = {
    getUser: vi.fn<CognitoAdminClient['getUser']>(async () => {
      calls.push('cognito:getUser');
      return null;
    }),
    createUser: vi.fn<CognitoAdminClient['createUser']>(async () => {
      calls.push('cognito:createUser');
      return 'created';
    }),
    resendInvitation: vi.fn<CognitoAdminClient['resendInvitation']>(
      async () => {
        calls.push('cognito:resend');
        return 'resent';
      },
    ),
  };
  const catalogs = {
    listResultTypes: vi.fn(async () => RESULT_TYPES),
    listSciencePrograms: vi.fn(async () => PROGRAMS),
  };
  const cache = {
    invalidate: vi.fn((userId: number) => {
      calls.push(`invalidate:${userId}`);
    }),
  };

  const unitOfWork = new RecordingUnitOfWork(
    new InMemoryUsersAdminUnitOfWork(db),
    calls,
  );
  const service = new UsersAdminService(
    unitOfWork,
    users,
    catalogs as unknown as CatalogService,
    cognito as unknown as CognitoAdminClient,
    cache as unknown as CurrentUserCache,
  );

  async function seedUser(seed: SeedUser): Promise<User> {
    const created = await users.create({
      email: seed.email,
      authSource: seed.authSource ?? 'custom',
      nickname: seed.nickname ?? null,
      firstName: seed.firstName ?? null,
      lastName: seed.lastName ?? null,
      lastLoginAt: seed.lastLoginAt ?? null,
      invitation: seed.invitation ?? 'none',
    });
    if (seed.isActive === false) {
      await users.update(created.id, { isActive: false });
    }
    for (const [roleCode, resultTypeKey] of seed.roles ?? []) {
      await assignments.create({
        userId: created.id,
        roleCode,
        resultTypeKey: resultTypeKey ?? null,
      });
    }
    return (await users.findById(created.id))!;
  }

  /** Everything the API could have written, for "nothing changed" assertions. */
  const snapshot = () =>
    JSON.stringify({
      users: db.users,
      assignments: db.assignments,
      scope: db.scope,
      exclusions: db.exclusions,
      audit: db.audit,
    });

  return {
    db,
    calls,
    users,
    assignments,
    programs,
    cognito,
    catalogs,
    cache,
    unitOfWork,
    service,
    seedUser,
    snapshot,
  };
}

export type AdminWorld = ReturnType<typeof adminWorld>;
