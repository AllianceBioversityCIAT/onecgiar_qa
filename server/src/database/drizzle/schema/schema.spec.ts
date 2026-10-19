import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MySqlDialect, getTableConfig } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import * as schema from './index.js';
import { roleAssignments, roles, users } from './index.js';

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
const names = (cols: ReadonlyArray<{ name?: string }>) =>
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
    expect(expr).toContain(
      "`status` <> 'active' AND `ended_at` IS NOT NULL AND `ended_by` IS NOT NULL",
    );
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

  it('are exactly two SQL files', () => {
    expect(files).toHaveLength(2);
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
