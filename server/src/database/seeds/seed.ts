import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';
import { eq } from 'drizzle-orm';
import { ROLE_DEFINITIONS, RoleCode } from '../../users/permissions.js';
import {
  DrizzleRoleAssignmentsStore,
  RoleAssignmentsRepository,
} from '../../users/role-assignments.repository.js';
import { DuplicateActiveAssignmentError } from '../../users/users.errors.js';
import {
  DrizzleUsersStore,
  UsersRepository,
} from '../../users/users.repository.js';
import * as schema from '../drizzle/schema/index.js';
import type { DrizzleDB } from '../drizzle/drizzle.module.js';
import {
  roles,
  type Role,
  type RoleScopeType,
} from '../drizzle/schema/roles.js';

/** Persistence port for the role part of the seed. */
export interface RoleSeedStore {
  findByCode(code: string): Promise<Role | undefined>;
  insert(role: {
    code: string;
    name: string;
    scopeType: RoleScopeType;
  }): Promise<void>;
}

/** Drizzle adapter of `RoleSeedStore`. */
export class DrizzleRoleSeedStore implements RoleSeedStore {
  constructor(private readonly db: Pick<DrizzleDB, 'select' | 'insert'>) {}

  async findByCode(code: string) {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.code, code))
      .limit(1);
    return row;
  }

  async insert(role: { code: string; name: string; scopeType: RoleScopeType }) {
    await this.db.insert(roles).values(role);
  }
}

export interface SeedDeps {
  roles: RoleSeedStore;
  users: Pick<UsersRepository, 'findOrCreateByEmail'>;
  assignments: Pick<RoleAssignmentsRepository, 'create'>;
}

export interface SeedReport {
  rolesCreated: string[];
  rolesExisting: string[];
  admin:
    | { status: 'skipped'; reason: string }
    | {
        status: 'done';
        email: string;
        userCreated: boolean;
        assignmentCreated: boolean;
      };
}

/**
 * Repeatable seed (FR-2). Roles are inserted when missing and never altered
 * once present (an administrator may have deactivated one); a stored role
 * whose scope type differs from the catalog is a data error, not something to
 * overwrite under existing assignments. The first ADMIN is seeded only when
 * `adminEmail` is given; running again creates nothing.
 */
export async function runSeed(
  deps: SeedDeps,
  options: { adminEmail?: string | null },
): Promise<SeedReport> {
  const rolesCreated: string[] = [];
  const rolesExisting: string[] = [];
  for (const definition of ROLE_DEFINITIONS) {
    const stored = await deps.roles.findByCode(definition.code);
    if (!stored) {
      await deps.roles.insert({
        code: definition.code,
        name: definition.name,
        scopeType: definition.scopeType,
      });
      rolesCreated.push(definition.code);
      continue;
    }
    if (stored.scopeType !== definition.scopeType) {
      throw new Error(
        `Role ${definition.code} is stored with scope type "${stored.scopeType}" but the catalog defines "${definition.scopeType}"; refusing to change it`,
      );
    }
    rolesExisting.push(definition.code);
  }

  const adminEmail = options.adminEmail?.trim() ?? '';
  if (adminEmail === '') {
    return {
      rolesCreated,
      rolesExisting,
      admin: {
        status: 'skipped',
        reason: 'SEED_ADMIN_EMAIL is not set; the first ADMIN was not seeded',
      },
    };
  }

  const { user, created: userCreated } = await deps.users.findOrCreateByEmail(
    adminEmail,
    { authSource: 'sso' },
  );
  let assignmentCreated = true;
  try {
    await deps.assignments.create({
      userId: user.id,
      roleCode: RoleCode.ADMIN,
      createdBy: null,
    });
  } catch (error) {
    if (!(error instanceof DuplicateActiveAssignmentError)) throw error;
    assignmentCreated = false;
  }
  return {
    rolesCreated,
    rolesExisting,
    admin: {
      status: 'done',
      email: user.email,
      userCreated,
      assignmentCreated,
    },
  };
}

export function formatReport(report: SeedReport): string[] {
  const lines = [
    `roles: ${report.rolesCreated.length} created, ${report.rolesExisting.length} already present`,
  ];
  lines.push(
    report.admin.status === 'skipped'
      ? `admin: skipped (${report.admin.reason})`
      : `admin: ${report.admin.email} — user ${report.admin.userCreated ? 'created' : 'already present'}, ADMIN assignment ${report.admin.assignmentCreated ? 'created' : 'already active'}`,
  );
  return lines;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = createPool({ uri: url, connectionLimit: 1 });
  const db = drizzle({ client: pool, schema, mode: 'default' });
  try {
    const report = await db.transaction((tx) =>
      runSeed(
        {
          roles: new DrizzleRoleSeedStore(tx),
          users: new UsersRepository(new DrizzleUsersStore(tx)),
          assignments: new RoleAssignmentsRepository(
            new DrizzleRoleAssignmentsStore(tx),
          ),
        },
        { adminEmail: process.env.SEED_ADMIN_EMAIL },
      ),
    );
    for (const line of formatReport(report)) console.log(line);
  } finally {
    await pool.end();
  }
}

// Run only when executed directly (`pnpm db:seed`), never on import.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
