import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MySqlDialect, getTableConfig } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import * as schema from './index.js';
import { idempotencyKeys, roleAssignments, roles, users } from './index.js';

// Schema metadata and the committed migration are checked against the
// requirements (FR-1), not against each other: removing a rule from the
// schema must fail here even after the migration is regenerated.
// Presence is not enforcement (premise P-15): the DB behavior itself is
// settled at the HITL step by running the inserts against a migrated DB.

const migrationsDir = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
);

function uniqueColumnSets(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table);
  return [
    // Column-level `.unique()`
    ...config.columns.filter((c) => c.isUnique).map((c) => [c.name]),
    // Table-level unique constraints and unique indexes
    ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
    ...config.indexes
      .filter((i) => i.config.unique)
      .map((i) => i.config.columns.map((c) => ('name' in c ? c.name : ''))),
  ];
}

const dialect = new MySqlDialect();
// Renders a CHECK / generated expression exactly as the migration emits it.
const render = (expr: SQL) => dialect.sqlToQuery(expr).sql;
const names = (cols: ReadonlyArray<object>) =>
  cols.map((c) => ('name' in c ? c.name : ''));

describe('users schema', () => {
  it('keeps email unique and cognito_sub unique (nullable until first login)', () => {
    const sets = uniqueColumnSets(users);
    expect(sets).toContainEqual(['email']);
    expect(sets).toContainEqual(['cognito_sub']);
    const columns = getTableConfig(users).columns;
    expect(columns.find((c) => c.name === 'cognito_sub')?.notNull).toBe(false);
    expect(columns.find((c) => c.name === 'email')?.notNull).toBe(true);
  });

  it('adds nickname (varchar(50), nullable, unique), invitation and invited_at (design 5)', () => {
    const config = getTableConfig(users);
    const col = (n: string) => config.columns.find((c) => c.name === n);
    expect(col('nickname')?.getSQLType()).toBe('varchar(50)');
    expect(col('nickname')?.notNull).toBe(false);
    expect(uniqueColumnSets(users)).toContainEqual(['nickname']);
    expect(col('invitation')?.getSQLType()).toBe(
      "enum('none','sent','existing_account')",
    );
    expect(col('invitation')?.notNull).toBe(true);
    expect(col('invitation')?.default).toBe('none');
    expect(col('invited_at')?.getSQLType()).toBe('datetime');
    expect(col('invited_at')?.notNull).toBe(false);
  });

  it('declares the lowercase email CHECK', () => {
    expect(getTableConfig(users).checks.map((c) => c.name)).toContain(
      'chk_users_email_lowercase',
    );
  });
});

describe('roles schema', () => {
  it('keeps code unique', () => {
    expect(uniqueColumnSets(roles)).toContainEqual(['code']);
  });
});

describe('role_assignments schema', () => {
  const config = getTableConfig(roleAssignments);

  it('declares active_key as a stored generated column', () => {
    const activeKey = config.columns.find((c) => c.name === 'active_key');
    expect(activeKey?.generated).toBeDefined();
    expect(activeKey?.generated?.mode).toBe('stored');
  });

  it('has a unique index on active_key only', () => {
    expect(uniqueColumnSets(roleAssignments)).toContainEqual(['active_key']);
  });

  it('indexes (user_id, is_active)', () => {
    const names = config.indexes.map((i) => [
      i.config.name,
      i.config.columns.map((c) => ('name' in c ? c.name : '')),
    ]);
    expect(names).toContainEqual([
      'idx_role_assignments_user_active',
      ['user_id', 'is_active'],
    ]);
  });

  it('declares the single-scope and revocation CHECKs', () => {
    expect(config.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'chk_role_assignments_one_scope',
        'chk_role_assignments_revocation',
      ]),
    );
  });

  it('references users for user, creator and revoker, and roles for the role', () => {
    const targets = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [
        ref.columns.map((c) => c.name)[0],
        getTableConfig(ref.foreignTable).name,
      ];
    });
    expect(targets).toEqual(
      expect.arrayContaining([
        ['user_id', 'users'],
        ['role_id', 'roles'],
        ['created_by', 'users'],
        ['revoked_by', 'users'],
      ]),
    );
  });
});

describe('user_programs schema', () => {
  it('exists with the composite primary key (user_id, program_id) and a users FK', () => {
    expect(schema.userPrograms).toBeDefined();
    const config = getTableConfig(schema.userPrograms);
    expect(config.name).toBe('user_programs');
    expect(config.primaryKeys).toHaveLength(1);
    expect(names(config.primaryKeys[0].columns)).toEqual([
      'user_id',
      'program_id',
    ]);
    expect(
      config.foreignKeys.map((fk) => fk.reference().columns[0].name),
    ).toEqual(['user_id']);
  });
});

describe('user_program_exclusions schema', () => {
  const get = () => {
    expect(schema.userProgramExclusions).toBeDefined();
    return getTableConfig(schema.userProgramExclusions);
  };
  const check = (name: string) => {
    const found = get().checks.find((c) => c.name === name);
    expect(found, `CHECK ${name}`).toBeDefined();
    return render(found!.value);
  };

  it('exists with origin, status and the ended_* history columns', () => {
    expect(schema.userProgramExclusions).toBeDefined();
    const cols = Object.fromEntries(get().columns.map((c) => [c.name, c]));
    expect(cols['origin'].getSQLType()).toBe("enum('manual','reporting')");
    expect(cols['status'].getSQLType()).toBe(
      "enum('active','removed','dismissed')",
    );
    expect(cols['status'].default).toBe('active');
    expect(cols['reason'].getSQLType()).toBe('varchar(500)');
    expect(cols['reporting_role'].getSQLType()).toBe('varchar(100)');
    expect(cols['reporting_role'].notNull).toBe(false);
    expect(cols['created_by'].notNull).toBe(false);
    for (const n of ['ended_at', 'ended_by', 'end_reason']) {
      expect(cols[n]?.notNull, n).toBe(false);
    }
  });

  it('declares active_key as a stored generated column that depends on status', () => {
    const activeKey = get().columns.find((c) => c.name === 'active_key');
    expect(activeKey?.generated?.mode).toBe('stored');
    const expr = render(activeKey!.generated!.as as SQL);
    expect(expr).toContain("`status` = 'active'");
    expect(expr).toContain('`user_id`');
    expect(expr).toContain('`program_id`');
    expect(expr).toContain('NULL');
  });

  it('has a unique index on active_key only', () => {
    expect(uniqueColumnSets(schema.userProgramExclusions)).toContainEqual([
      'active_key',
    ]);
  });

  it('references users for user, creator and ender', () => {
    const targets = get().foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns[0].name, getTableConfig(ref.foreignTable).name];
    });
    expect(targets).toEqual(
      expect.arrayContaining([
        ['user_id', 'users'],
        ['created_by', 'users'],
        ['ended_by', 'users'],
      ]),
    );
  });

  it('CHECK: a manual exclusion requires a non-empty reason', () => {
    const expr = check('chk_user_program_exclusions_manual_reason');
    expect(expr).toContain("`origin` <> 'manual'");
    expect(expr).toContain('`reason` IS NOT NULL');
    expect(expr).toMatch(/TRIM\(`reason`\) <> ''/);
  });

  it('CHECK: dismissed requires origin reporting and a non-empty end_reason', () => {
    const expr = check('chk_user_program_exclusions_dismissed');
    expect(expr).toContain("`status` <> 'dismissed'");
    expect(expr).toContain("`origin` = 'reporting'");
    expect(expr).toContain('`end_reason` IS NOT NULL');
    expect(expr).toMatch(/TRIM\(`end_reason`\) <> ''/);
  });

  it('CHECK: ended fields are set if and only if the status is not active', () => {
    const expr = check('chk_user_program_exclusions_ended');
    expect(expr).toContain(
      "`status` = 'active' AND `ended_at` IS NULL AND `ended_by` IS NULL AND `end_reason` IS NULL",
    );
    // ended_at is mandatory once ended; ended_by is mandatory too, except for
    // a system end: origin reporting AND status removed (DD-12).
    expect(expr).toContain(
      "`status` <> 'active' AND `ended_at` IS NOT NULL AND (`ended_by` IS NOT NULL OR (`origin` = 'reporting' AND `status` = 'removed'))",
    );
    // A NULL ended_by must never be allowed outside that one exception.
    expect(expr.match(/`ended_by` IS NULL/g)).toHaveLength(1);
    expect(expr).not.toMatch(/`ended_by` IS NOT NULL OR `origin`/);
    expect(expr).not.toContain("`origin` = 'manual'");
    expect(expr).not.toContain("`status` = 'dismissed'");
  });
});

describe('user_audit_events schema', () => {
  const get = () => {
    expect(schema.userAuditEvents).toBeDefined();
    return getTableConfig(schema.userAuditEvents);
  };

  it('stores who, what, when and before/after, and nothing mutable', () => {
    expect(schema.userAuditEvents).toBeDefined();
    const cols = Object.fromEntries(get().columns.map((c) => [c.name, c]));
    // Append-only: no updated_at / ended_* / revoked_* columns to mutate.
    expect(Object.keys(cols).sort()).toEqual(
      [
        'action',
        'actor_id',
        'changes',
        'created_at',
        'id',
        'request_id',
        'user_id',
      ].sort(),
    );
    expect(cols['changes'].getSQLType()).toBe('json');
    expect(cols['changes'].notNull).toBe(true);
    expect(cols['user_id'].notNull).toBe(true);
    expect(cols['actor_id'].notNull).toBe(true);
    expect(cols['created_at'].notNull).toBe(true);
    expect(cols['request_id'].notNull).toBe(false);
    expect(cols['action'].getSQLType()).toMatch(/^enum\(/);
  });

  it('covers every audited change of FR-13', () => {
    const action = get().columns.find((c) => c.name === 'action');
    expect(action?.enumValues).toEqual(
      expect.arrayContaining([
        'create',
        'update',
        'role_grant',
        'role_revoke',
        'scope_change',
        'exclusion_add',
        'exclusion_remove',
        'exclusion_dismiss',
        'deactivate',
        'reactivate',
        'invitation_resend',
      ]),
    );
  });

  it('indexes (user_id, created_at) and references users twice', () => {
    expect(
      get().indexes.map((i) => [i.config.name, names(i.config.columns)]),
    ).toContainEqual([
      'idx_user_audit_events_user_created',
      ['user_id', 'created_at'],
    ]);
    expect(
      get()
        .foreignKeys.map((fk) => fk.reference().columns[0].name)
        .sort(),
    ).toEqual(['actor_id', 'user_id']);
  });
});

describe('committed migrations', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('are exactly four SQL files', () => {
    expect(files).toHaveLength(4);
  });

  const sql = readFileSync(`${migrationsDir}${files[0]}`, 'utf8');

  it('creates the three tables', () => {
    for (const table of ['users', 'roles', 'role_assignments']) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it('carries the unique constraints', () => {
    expect(sql).toMatch(/UNIQUE\(`email`\)/);
    expect(sql).toMatch(/UNIQUE\(`cognito_sub`\)/);
    expect(sql).toMatch(/UNIQUE\(`code`\)/);
    expect(sql).toMatch(/UNIQUE\(`active_key`\)/);
  });

  it('carries the active_key generated expression of design section 5', () => {
    expect(sql).toContain(
      "`active_key` varchar(128) GENERATED ALWAYS AS (IF(`is_active`, CONCAT_WS(':', `user_id`, `role_id`, COALESCE(`result_type_key`, ''), COALESCE(`program_id`, '')), NULL)) STORED",
    );
  });

  it('carries the CHECK constraints', () => {
    expect(sql).toMatch(
      /CONSTRAINT `chk_users_email_lowercase` CHECK\(CAST\(`email` AS BINARY\) = CAST\(LOWER\(`email`\) AS BINARY\)\)/,
    );
    expect(sql).toMatch(
      /CONSTRAINT `chk_role_assignments_one_scope` CHECK\(`result_type_key` IS NULL OR `program_id` IS NULL\)/,
    );
    expect(sql).toMatch(/CONSTRAINT `chk_role_assignments_revocation` CHECK\(/);
  });
});

describe('committed migration 0001 (user management)', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sql = files[1]
    ? readFileSync(`${migrationsDir}${files[1]}`, 'utf8')
    : '';

  it('is additive only: no drop, no data rewrite, only ADD on users', () => {
    expect(files[1]).toMatch(/^0001_/);
    expect(sql).not.toMatch(
      /\bDROP\b|\bINSERT INTO\b|\bUPDATE `\w+` SET\b|\bDELETE FROM\b|\bTRUNCATE\b|\bMODIFY\b|\bRENAME\b/,
    );
    const alters = sql.match(/ALTER TABLE `users` [^;]*/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) {
      expect(a).toMatch(/ADD (`|CONSTRAINT)/);
    }
  });

  it('adds the users columns and the nickname unique constraint', () => {
    expect(sql).toContain('ALTER TABLE `users` ADD `nickname` varchar(50)');
    expect(sql).toContain(
      "ALTER TABLE `users` ADD `invitation` enum('none','sent','existing_account') DEFAULT 'none' NOT NULL",
    );
    expect(sql).toContain('ALTER TABLE `users` ADD `invited_at` datetime');
    expect(sql).toContain(
      'ALTER TABLE `users` ADD CONSTRAINT `uq_users_nickname` UNIQUE(`nickname`)',
    );
  });

  it('creates the three tables with their keys', () => {
    for (const t of [
      'user_programs',
      'user_program_exclusions',
      'user_audit_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE \`${t}\``);
    }
    expect(sql).toMatch(/PRIMARY KEY\(`user_id`,`program_id`\)/);
    expect(sql).toMatch(/UNIQUE\(`active_key`\)/);
    expect(sql).toContain(
      "`active_key` varchar(64) GENERATED ALWAYS AS (IF(`status` = 'active', CONCAT_WS(':', `user_id`, `program_id`), NULL)) STORED",
    );
    expect(sql).toMatch(
      /CREATE INDEX `idx_user_audit_events_user_created` ON `user_audit_events` \(`user_id`,`created_at`\)/,
    );
  });

  it('carries the three exclusion CHECKs', () => {
    for (const n of ['manual_reason', 'dismissed', 'ended']) {
      expect(sql).toContain(
        `CONSTRAINT \`chk_user_program_exclusions_${n}\` CHECK(`,
      );
    }
    expect(sql).toMatch(/`status` <> 'dismissed' OR \(`origin` = 'reporting'/);
  });
});

describe('idempotency_keys schema (users-admin-write-safety design 5)', () => {
  const config = getTableConfig(idempotencyKeys);
  const col = (n: string) => config.columns.find((c) => c.name === n);

  it('uses (actor_id, idem_key) as the composite primary key: per admin (FR-6)', () => {
    expect(config.primaryKeys).toHaveLength(1);
    expect(names(config.primaryKeys[0].columns)).toEqual([
      'actor_id',
      'idem_key',
    ]);
    // No single-column PK: a key alone must never identify a row.
    expect(config.columns.filter((c) => c.primary)).toHaveLength(0);
  });

  it('references users from actor_id', () => {
    const fks = config.foreignKeys.map((f) => {
      const ref = f.reference();
      return [names(ref.columns), getTableConfig(ref.foreignTable).name];
    });
    expect(fks).toContainEqual([['actor_id'], 'users']);
    expect(col('actor_id')?.notNull).toBe(true);
    expect(col('actor_id')?.getSQLType()).toBe('int unsigned');
  });

  it('types the key, fingerprint and owner token', () => {
    // Opaque, case-sensitive key (FR-6): ascii_bin, so keys that differ only
    // by case never collide in the PK.
    expect(col('idem_key')?.getSQLType()).toBe(
      'varchar(128) CHARACTER SET ascii COLLATE ascii_bin',
    );
    expect(col('fingerprint')?.getSQLType()).toBe('char(64)');
    expect(col('owner_token')?.getSQLType()).toBe('char(36)');
    for (const n of ['idem_key', 'fingerprint', 'owner_token']) {
      expect(col(n)?.notNull).toBe(true);
    }
  });

  it('declares the three states (FR-2, FR-5)', () => {
    expect(col('state')?.getSQLType()).toBe(
      "enum('in_progress','executed','completed')",
    );
    expect(col('state')?.notNull).toBe(true);
  });

  it('keeps lease, route status and expiry mandatory', () => {
    expect(col('lease_until')?.getSQLType()).toBe('datetime');
    expect(col('lease_until')?.notNull).toBe(true);
    expect(col('route_status')?.getSQLType()).toBe('smallint');
    expect(col('route_status')?.notNull).toBe(true);
    expect(col('created_at')?.notNull).toBe(true);
    expect(col('expires_at')?.getSQLType()).toBe('datetime');
    expect(col('expires_at')?.notNull).toBe(true);
  });

  it('leaves the answer columns nullable until the answer is stored', () => {
    expect(col('target_user_id')?.notNull).toBe(false);
    expect(col('response_status')?.notNull).toBe(false);
    expect(col('response_body')?.notNull).toBe(false);
    expect(col('response_body')?.getSQLType()).toBe('json');
  });

  it('indexes expires_at for the retention purge (NFR-5)', () => {
    const idx = config.indexes.find((i) => !i.config.unique);
    expect(idx).toBeDefined();
    expect(names(idx!.config.columns)).toEqual(['expires_at']);
  });
});

describe('committed migration 0002 (idempotency keys)', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sql = files[2]
    ? readFileSync(`${migrationsDir}${files[2]}`, 'utf8')
    : '';

  it('is additive only: one new table, no change to any existing table', () => {
    expect(files[2]).toMatch(/^0002_/);
    // drizzle emits the FK as ALTER ... ADD CONSTRAINT on the new table; every
    // ALTER must target idempotency_keys and only add.
    for (const a of sql.match(/\bALTER TABLE [^;]*/g) ?? []) {
      expect(a).toMatch(/^ALTER TABLE `idempotency_keys` ADD CONSTRAINT /);
    }
    expect(sql).not.toMatch(
      /\bDROP\b|\bINSERT INTO\b|\bUPDATE `\w+` SET\b|\bDELETE FROM\b|\bTRUNCATE\b|\bMODIFY\b|\bRENAME\b/,
    );
    expect(sql.match(/CREATE TABLE/g) ?? []).toHaveLength(1);
    expect(sql).toContain('CREATE TABLE `idempotency_keys`');
  });

  it('carries the composite primary key, the user FK and the expiry index', () => {
    expect(sql).toMatch(/PRIMARY KEY\(`actor_id`,`idem_key`\)/);
    expect(sql).toContain(
      '`idem_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,',
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(`actor_id`\) REFERENCES `users`\(`id`\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX `idx_idempotency_keys_expires` ON `idempotency_keys` \(`expires_at`\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// cycle-timelines (design 5): six tables, migration 0003.
// ---------------------------------------------------------------------------

type AnyTable = Parameters<typeof getTableConfig>[0];

// A pin on a table that does not exist yet fails as an assertion, not as a
// TypeError from inside drizzle.
const tableConfig = (table: AnyTable | undefined) => {
  expect(table, 'the table is exported by schema/index.ts').toBeDefined();
  return getTableConfig(table!);
};

// `name -> "<sql type>[ NOT NULL]"`, compared whole so a column added, dropped
// or retyped fails here.
function shape(table: AnyTable) {
  return Object.fromEntries(
    tableConfig(table).columns.map((c) => [
      c.name,
      `${c.getSQLType()}${c.notNull ? ' NOT NULL' : ''}`,
    ]),
  );
}
const columnOf = (table: AnyTable, name: string) => {
  const found = tableConfig(table).columns.find((c) => c.name === name);
  expect(found, `column ${name}`).toBeDefined();
  return found!;
};
const checkOf = (table: AnyTable, name: string) => {
  const found = tableConfig(table).checks.find((c) => c.name === name);
  expect(found, `CHECK ${name}`).toBeDefined();
  return render(found!.value);
};
const checkNames = (table: AnyTable) =>
  tableConfig(table)
    .checks.map((c) => c.name)
    .sort();
// Every unique key of the table: constraint name -> column list.
const uniqueKeys = (table: AnyTable) => {
  const config = tableConfig(table);
  return {
    ...Object.fromEntries(
      config.uniqueConstraints.map((u) => [u.name, names(u.columns)]),
    ),
    ...Object.fromEntries(
      config.indexes
        .filter((i) => i.config.unique)
        .map((i) => [i.config.name, names(i.config.columns)]),
    ),
  };
};
const plainIndexes = (table: AnyTable) =>
  Object.fromEntries(
    tableConfig(table)
      .indexes.filter((i) => !i.config.unique)
      .map((i) => [i.config.name, names(i.config.columns)]),
  );
const foreignKeys = (table: AnyTable) =>
  tableConfig(table)
    .foreignKeys.map((fk) => {
      const ref = fk.reference();
      return `${ref.columns[0].name} -> ${tableConfig(ref.foreignTable).name}.${ref.foreignColumns[0].name}`;
    })
    .sort();
const generatedSql = (table: AnyTable, name: string) => {
  const column = columnOf(table, name);
  expect(column.generated?.mode, `${name} is stored`).toBe('stored');
  return render(column.generated!.as as SQL);
};

describe('cycles schema (cycle-timelines design 5, FR-1, FR-3)', () => {
  it('has exactly these columns and types', () => {
    expect(schema.cycles).toBeDefined();
    expect(shape(schema.cycles)).toEqual({
      id: 'int unsigned NOT NULL',
      year: 'smallint unsigned NOT NULL',
      status: "enum('draft','active','closed') NOT NULL",
      active_key: 'tinyint',
      created_at: 'datetime NOT NULL',
      created_by: 'int unsigned NOT NULL',
      activated_at: 'datetime',
      activated_by: 'int unsigned',
      closed_at: 'datetime',
      closed_by: 'int unsigned',
    });
  });

  it('starts a cycle as draft: never active by being created (FR-1)', () => {
    expect(columnOf(schema.cycles, 'status').default).toBe('draft');
    expect(columnOf(schema.cycles, 'status').enumValues).toEqual([
      'draft',
      'active',
      'closed',
    ]);
    expect(columnOf(schema.cycles, 'id').primary).toBe(true);
  });

  it('keeps one cycle per year and at most one active cycle (FR-1, FR-3, NFR-3)', () => {
    expect(uniqueKeys(schema.cycles)).toEqual({
      uq_cycles_year: ['year'],
      uq_cycles_active_key: ['active_key'],
    });
  });

  it('derives active_key as 1 only while the status is active', () => {
    expect(generatedSql(schema.cycles, 'active_key')).toBe(
      "IF(`status` = 'active', 1, NULL)",
    );
  });

  it('declares exactly the year and lifecycle CHECKs', () => {
    expect(checkNames(schema.cycles)).toEqual([
      'chk_cycles_lifecycle',
      'chk_cycles_year',
    ]);
  });

  it('CHECK: the year is 2020-2100 (FR-1)', () => {
    expect(checkOf(schema.cycles, 'chk_cycles_year')).toBe(
      '`year` BETWEEN 2020 AND 2100',
    );
  });

  it('CHECK: draft has no lifecycle data, active is activated and not closed, closed is closed', () => {
    expect(checkOf(schema.cycles, 'chk_cycles_lifecycle')).toBe(
      "(`status` = 'draft' AND `activated_at` IS NULL AND `activated_by` IS NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'active' AND `activated_at` IS NOT NULL AND `activated_by` IS NOT NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'closed' AND `closed_at` IS NOT NULL AND `closed_by` IS NOT NULL)",
    );
  });

  it('references users for the creator, the activator and the closer', () => {
    expect(foreignKeys(schema.cycles)).toEqual([
      'activated_by -> users.id',
      'closed_by -> users.id',
      'created_by -> users.id',
    ]);
  });
});

describe('timelines schema (design 5, FR-5, FR-6)', () => {
  it('has exactly these columns and types', () => {
    expect(schema.timelines).toBeDefined();
    expect(shape(schema.timelines)).toEqual({
      id: 'int unsigned NOT NULL',
      cycle_id: 'int unsigned NOT NULL',
      name: 'varchar(120) COLLATE utf8mb4_0900_ai_ci NOT NULL',
      kind: "enum('official','additional') NOT NULL",
      official_key: 'int unsigned',
      all_programs: 'boolean NOT NULL',
      all_result_types: 'boolean NOT NULL',
      created_at: 'datetime NOT NULL',
      created_by: 'int unsigned NOT NULL',
    });
  });

  it('compares the name case-insensitively: an explicit _ci collation (FR-6)', () => {
    const type = columnOf(schema.timelines, 'name').getSQLType();
    expect(type).toBe('varchar(120) COLLATE utf8mb4_0900_ai_ci');
    // Neither binary nor case-sensitive: "July 2026" and "july 2026" collide.
    expect(type).toMatch(/COLLATE utf8mb4_\w+_ci$/);
    expect(type).not.toMatch(/_bin|_cs/);
  });

  it('names the kind enum with exactly official and additional', () => {
    expect(columnOf(schema.timelines, 'kind').enumValues).toEqual([
      'official',
      'additional',
    ]);
  });

  it('has no default on the scope flags: a missing flag is refused, never false (DD-6, FR-6)', () => {
    for (const n of ['all_programs', 'all_result_types']) {
      expect(columnOf(schema.timelines, n).hasDefault, n).toBe(false);
      expect(columnOf(schema.timelines, n).notNull, n).toBe(true);
    }
  });

  it('derives official_key as the cycle id while official, NULL for additional (FR-5, DD-3)', () => {
    expect(generatedSql(schema.timelines, 'official_key')).toBe(
      "IF(`kind` = 'official', `cycle_id`, NULL)",
    );
  });

  it('keeps one name per cycle and one official per cycle (FR-5, FR-6, NFR-3)', () => {
    expect(uniqueKeys(schema.timelines)).toEqual({
      uq_timelines_cycle_name: ['cycle_id', 'name'],
      uq_timelines_official_key: ['official_key'],
    });
  });

  it('indexes cycle_id', () => {
    expect(plainIndexes(schema.timelines)).toEqual({
      idx_timelines_cycle: ['cycle_id'],
    });
  });

  it('references cycles and the creator', () => {
    expect(foreignKeys(schema.timelines)).toEqual([
      'created_by -> users.id',
      'cycle_id -> cycles.id',
    ]);
  });
});

describe('timeline_programs and timeline_result_types schema (design 5, DD-6)', () => {
  it('timeline_programs: (timeline_id, program_id) key, a timelines FK and no FK on the CLARISA id', () => {
    expect(schema.timelinePrograms).toBeDefined();
    const config = getTableConfig(schema.timelinePrograms);
    expect(config.name).toBe('timeline_programs');
    expect(shape(schema.timelinePrograms)).toEqual({
      timeline_id: 'int unsigned NOT NULL',
      program_id: 'int unsigned NOT NULL',
    });
    expect(config.primaryKeys).toHaveLength(1);
    expect(names(config.primaryKeys[0].columns)).toEqual([
      'timeline_id',
      'program_id',
    ]);
    expect(foreignKeys(schema.timelinePrograms)).toEqual([
      'timeline_id -> timelines.id',
    ]);
  });

  it('timeline_result_types: (timeline_id, result_type_key) key, a timelines FK and no FK on the catalog key', () => {
    expect(schema.timelineResultTypes).toBeDefined();
    const config = getTableConfig(schema.timelineResultTypes);
    expect(config.name).toBe('timeline_result_types');
    expect(shape(schema.timelineResultTypes)).toEqual({
      timeline_id: 'int unsigned NOT NULL',
      result_type_key: 'varchar(64) NOT NULL',
    });
    expect(config.primaryKeys).toHaveLength(1);
    expect(names(config.primaryKeys[0].columns)).toEqual([
      'timeline_id',
      'result_type_key',
    ]);
    expect(foreignKeys(schema.timelineResultTypes)).toEqual([
      'timeline_id -> timelines.id',
    ]);
  });
});

describe('timeline_steps schema (design 5, FR-8, FR-9)', () => {
  it('has exactly these columns and types', () => {
    expect(schema.timelineSteps).toBeDefined();
    expect(shape(schema.timelineSteps)).toEqual({
      id: 'int unsigned NOT NULL',
      timeline_id: 'int unsigned NOT NULL',
      position: 'tinyint unsigned NOT NULL',
      name: 'varchar(120) NOT NULL',
      audience:
        "enum('assessors','programs','lead_assessors','tpb','ppu') NOT NULL",
      opens_on: 'date NOT NULL',
      closes_on: 'date NOT NULL',
      round: 'tinyint unsigned NOT NULL',
      requires_load: 'boolean NOT NULL',
    });
  });

  it('reads and writes opens_on and closes_on as YYYY-MM-DD strings, not Date (DD-5, P-12)', () => {
    for (const n of ['opens_on', 'closes_on']) {
      const column = columnOf(schema.timelineSteps, n);
      expect(column.dataType, n).toBe('string');
      expect(column.columnType, n).toBe('MySqlDateString');
    }
  });

  it('lists the audiences in order (S-2, D-3)', () => {
    expect(columnOf(schema.timelineSteps, 'audience').enumValues).toEqual([
      'assessors',
      'programs',
      'lead_assessors',
      'tpb',
      'ppu',
    ]);
  });

  it('keeps one step per position and one per audience in a timeline', () => {
    expect(uniqueKeys(schema.timelineSteps)).toEqual({
      uq_timeline_steps_position: ['timeline_id', 'position'],
      uq_timeline_steps_audience: ['timeline_id', 'audience'],
    });
  });

  it('declares exactly the four step CHECKs', () => {
    expect(checkNames(schema.timelineSteps)).toEqual([
      'chk_timeline_steps_dates',
      'chk_timeline_steps_first_load',
      'chk_timeline_steps_position',
      'chk_timeline_steps_round',
    ]);
  });

  it('CHECK: position is 1-5', () => {
    expect(checkOf(schema.timelineSteps, 'chk_timeline_steps_position')).toBe(
      '`position` BETWEEN 1 AND 5',
    );
  });

  it('CHECK: a step closes on or after the day it opens; the same day is valid (FR-8)', () => {
    // `>=`, not `>`: a one-day step is valid.
    expect(checkOf(schema.timelineSteps, 'chk_timeline_steps_dates')).toBe(
      '`closes_on` >= `opens_on`',
    );
  });

  it('CHECK: the round is at least 1', () => {
    expect(checkOf(schema.timelineSteps, 'chk_timeline_steps_round')).toBe(
      '`round` >= 1',
    );
  });

  it('CHECK: the first step requires a load, refused rather than defaulted (FR-9)', () => {
    expect(checkOf(schema.timelineSteps, 'chk_timeline_steps_first_load')).toBe(
      '`position` <> 1 OR `requires_load`',
    );
    expect(columnOf(schema.timelineSteps, 'requires_load').hasDefault).toBe(
      false,
    );
  });

  it('references timelines', () => {
    expect(foreignKeys(schema.timelineSteps)).toEqual([
      'timeline_id -> timelines.id',
    ]);
  });
});

describe('timeline_users schema (design 5, FR-14, FR-15)', () => {
  it('has exactly these columns and types', () => {
    expect(schema.timelineUsers).toBeDefined();
    expect(shape(schema.timelineUsers)).toEqual({
      id: 'int unsigned NOT NULL',
      timeline_id: 'int unsigned NOT NULL',
      user_id: 'int unsigned NOT NULL',
      role_id: 'smallint unsigned NOT NULL',
      assigned_at: 'datetime NOT NULL',
      assigned_by: 'int unsigned NOT NULL',
      removed_at: 'datetime',
      removed_by: 'int unsigned',
      active_key: 'varchar(64)',
    });
  });

  it('derives active_key as timeline:user:role while not removed, NULL once removed', () => {
    expect(generatedSql(schema.timelineUsers, 'active_key')).toBe(
      "IF(`removed_at` IS NULL, CONCAT_WS(':', `timeline_id`, `user_id`, `role_id`), NULL)",
    );
  });

  it('keeps a single active row per (timeline, user, role); a removed row never blocks (FR-14, FR-15)', () => {
    expect(uniqueKeys(schema.timelineUsers)).toEqual({
      uq_timeline_users_active_key: ['active_key'],
    });
  });

  it('indexes timeline_id', () => {
    expect(plainIndexes(schema.timelineUsers)).toEqual({
      idx_timeline_users_timeline: ['timeline_id'],
    });
  });

  it('declares exactly the removal CHECK: both set or both NULL, the row is kept (FR-15)', () => {
    expect(checkNames(schema.timelineUsers)).toEqual([
      'chk_timeline_users_removed',
    ]);
    expect(checkOf(schema.timelineUsers, 'chk_timeline_users_removed')).toBe(
      '(`removed_at` IS NULL AND `removed_by` IS NULL) OR (`removed_at` IS NOT NULL AND `removed_by` IS NOT NULL)',
    );
  });

  it('references timelines, users (user, assigner, remover) and roles', () => {
    expect(foreignKeys(schema.timelineUsers)).toEqual([
      'assigned_by -> users.id',
      'removed_by -> users.id',
      'role_id -> roles.id',
      'timeline_id -> timelines.id',
      'user_id -> users.id',
    ]);
  });
});

describe('committed migration 0003 (cycle timelines)', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sql = files[3]
    ? readFileSync(`${migrationsDir}${files[3]}`, 'utf8')
    : '';
  const newTables = [
    'cycles',
    'timelines',
    'timeline_programs',
    'timeline_result_types',
    'timeline_steps',
    'timeline_users',
  ];

  it('is named 0003_cycle_timelines and registered in the journal', () => {
    expect(files[3]).toBe('0003_cycle_timelines.sql');
    const journal = JSON.parse(
      readFileSync(`${migrationsDir}meta/_journal.json`, 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toEqual(
      files.map((f) => f.replace(/\.sql$/, '')),
    );
  });

  it('is additive only: it creates exactly the six new tables and nothing else', () => {
    expect(sql).not.toMatch(
      /\bDROP\b|\bINSERT INTO\b|\bUPDATE `\w+` SET\b|\bDELETE FROM\b|\bTRUNCATE\b|\bMODIFY\b|\bRENAME\b/,
    );
    expect(
      [...sql.matchAll(/CREATE TABLE `(\w+)`/g)].map((m) => m[1]).sort(),
    ).toEqual([...newTables].sort());
    // Every ALTER adds a foreign key to a new table, and never touches an
    // existing one (users, roles, role_assignments, ...).
    const alters = sql.match(/\bALTER TABLE [^;]*/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) {
      expect(a).toMatch(
        new RegExp(
          `^ALTER TABLE \`(${newTables.join('|')})\` ADD CONSTRAINT \`\\w+\` FOREIGN KEY `,
        ),
      );
    }
    // Every CREATE INDEX is on a new table too.
    for (const i of sql.match(/\bCREATE (?:UNIQUE )?INDEX [^;]*/g) ?? []) {
      expect(i).toMatch(new RegExp(`ON \`(${newTables.join('|')})\` `));
    }
  });

  it('does not create the load tables reserved for P2-3905 / P2-3906 (NFR-6)', () => {
    expect(sql).not.toContain('timeline_loads');
    expect(sql).not.toContain('timeline_results');
  });

  it('carries the generated keys of design 5 verbatim', () => {
    expect(sql).toContain(
      "`active_key` tinyint GENERATED ALWAYS AS (IF(`status` = 'active', 1, NULL)) STORED",
    );
    expect(sql).toContain(
      "`official_key` int unsigned GENERATED ALWAYS AS (IF(`kind` = 'official', `cycle_id`, NULL)) STORED",
    );
    expect(sql).toContain(
      "`active_key` varchar(64) GENERATED ALWAYS AS (IF(`removed_at` IS NULL, CONCAT_WS(':', `timeline_id`, `user_id`, `role_id`), NULL)) STORED",
    );
  });

  it('carries every unique key', () => {
    for (const u of [
      'CONSTRAINT `uq_cycles_year` UNIQUE(`year`)',
      'CONSTRAINT `uq_cycles_active_key` UNIQUE(`active_key`)',
      'CONSTRAINT `uq_timelines_cycle_name` UNIQUE(`cycle_id`,`name`)',
      'CONSTRAINT `uq_timelines_official_key` UNIQUE(`official_key`)',
      'CONSTRAINT `uq_timeline_steps_position` UNIQUE(`timeline_id`,`position`)',
      'CONSTRAINT `uq_timeline_steps_audience` UNIQUE(`timeline_id`,`audience`)',
      'CONSTRAINT `uq_timeline_users_active_key` UNIQUE(`active_key`)',
    ]) {
      expect(sql, u).toContain(u);
    }
  });

  it('carries every CHECK verbatim', () => {
    for (const c of [
      'CONSTRAINT `chk_cycles_year` CHECK(`year` BETWEEN 2020 AND 2100)',
      "CONSTRAINT `chk_cycles_lifecycle` CHECK((`status` = 'draft' AND `activated_at` IS NULL AND `activated_by` IS NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'active' AND `activated_at` IS NOT NULL AND `activated_by` IS NOT NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'closed' AND `closed_at` IS NOT NULL AND `closed_by` IS NOT NULL))",
      'CONSTRAINT `chk_timeline_steps_position` CHECK(`position` BETWEEN 1 AND 5)',
      'CONSTRAINT `chk_timeline_steps_dates` CHECK(`closes_on` >= `opens_on`)',
      'CONSTRAINT `chk_timeline_steps_round` CHECK(`round` >= 1)',
      'CONSTRAINT `chk_timeline_steps_first_load` CHECK(`position` <> 1 OR `requires_load`)',
      'CONSTRAINT `chk_timeline_users_removed` CHECK((`removed_at` IS NULL AND `removed_by` IS NULL) OR (`removed_at` IS NOT NULL AND `removed_by` IS NOT NULL))',
    ]) {
      expect(sql, c).toContain(c);
    }
  });

  it('carries the case-insensitive name collation, the date columns and the scope flags without defaults', () => {
    expect(sql).toContain(
      '`name` varchar(120) COLLATE utf8mb4_0900_ai_ci NOT NULL,',
    );
    expect(sql).toContain('`opens_on` date NOT NULL,');
    expect(sql).toContain('`closes_on` date NOT NULL,');
    expect(sql).toContain('`all_programs` boolean NOT NULL,');
    expect(sql).toContain('`all_result_types` boolean NOT NULL,');
    expect(sql).toContain('`requires_load` boolean NOT NULL,');
    expect(sql).toContain(
      "`status` enum('draft','active','closed') NOT NULL DEFAULT 'draft',",
    );
  });

  it('carries the composite keys and the two plain indexes', () => {
    expect(sql).toMatch(
      /CONSTRAINT `timeline_programs_timeline_id_program_id_pk` PRIMARY KEY\(`timeline_id`,`program_id`\)/,
    );
    expect(sql).toMatch(
      /CONSTRAINT `timeline_result_types_timeline_id_result_type_key_pk` PRIMARY KEY\(`timeline_id`,`result_type_key`\)/,
    );
    expect(sql).toContain(
      'CREATE INDEX `idx_timelines_cycle` ON `timelines` (`cycle_id`)',
    );
    expect(sql).toContain(
      'CREATE INDEX `idx_timeline_users_timeline` ON `timeline_users` (`timeline_id`)',
    );
  });

  it('gives the four entity tables an auto-increment unsigned id', () => {
    expect(
      sql.match(/`id` int unsigned AUTO_INCREMENT NOT NULL,/g),
    ).toHaveLength(4);
  });

  it('carries the 13 foreign keys (3 + 2 + 1 + 1 + 1 + 5)', () => {
    expect(sql.match(/ADD CONSTRAINT `\w+_fk` FOREIGN KEY/g)).toHaveLength(13);
    expect(sql).toContain('FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`)');
    expect(sql).toContain('FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)');
  });
});
