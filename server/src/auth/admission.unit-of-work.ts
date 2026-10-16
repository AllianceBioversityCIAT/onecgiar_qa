import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleRoleAssignmentsStore,
  RoleAssignmentsRepository,
} from '../users/role-assignments.repository.js';
import {
  DrizzleUsersStore,
  UsersRepository,
} from '../users/users.repository.js';
import type {
  AdmissionRepositories,
  AdmissionUnitOfWork,
} from './admission.service.js';

/**
 * One MySQL transaction (default isolation, REPEATABLE READ) whose
 * repositories are the same ones the rest of the app uses, bound to it.
 */
@Injectable()
export class DrizzleAdmissionUnitOfWork implements AdmissionUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  run<T>(
    work: (repositories: AdmissionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((tx) =>
      work({
        users: new UsersRepository(new DrizzleUsersStore(tx)),
        assignments: new RoleAssignmentsRepository(
          new DrizzleRoleAssignmentsStore(tx),
        ),
      }),
    );
  }
}
