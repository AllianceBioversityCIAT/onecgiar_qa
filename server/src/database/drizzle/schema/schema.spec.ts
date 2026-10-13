import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/mysql-core';
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

describe('users schema', () => {
  it('keeps email unique and cognito_sub unique (nullable until first login)', () => {
    const sets = uniqueColumnSets(users);
    expect(sets).toContainEqual(['email']);
    expect(sets).toContainEqual(['cognito_sub']);
    const columns = getTableConfig(users).columns;
    expect(columns.find((c) => c.name === 'cognito_sub')?.notNull).toBe(false);
    expect(columns.find((c) => c.name === 'email')?.notNull).toBe(true);
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

describe('committed migration', () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  it('is exactly one SQL file', () => {
    expect(files).toHaveLength(1);
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
