import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  datetime,
  index,
  int,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { roles } from './roles.js';
import { users } from './users.js';

// Column names are written unqualified inside the generated column and the
// CHECKs so the emitted SQL carries no `table`.`column` prefix there.
const userId = sql.identifier('user_id');
const roleId = sql.identifier('role_id');
const resultTypeKey = sql.identifier('result_type_key');
const programId = sql.identifier('program_id');
const isActive = sql.identifier('is_active');
const revokedAt = sql.identifier('revoked_at');
const revokedBy = sql.identifier('revoked_by');

export const roleAssignments = mysqlTable(
  'role_assignments',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    userId: int('user_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    roleId: smallint('role_id', { unsigned: true })
      .notNull()
      .references(() => roles.id),
    resultTypeKey: varchar('result_type_key', { length: 64 }),
    programId: int('program_id', { unsigned: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: int('created_by', { unsigned: true }).references(() => users.id),
    revokedAt: datetime('revoked_at'),
    revokedBy: int('revoked_by', { unsigned: true }).references(() => users.id),
    // Identity of an ACTIVE assignment; NULL once revoked, so a revoked row
    // never collides with a new grant (design DD-7).
    activeKey: varchar('active_key', { length: 128 }).generatedAlwaysAs(
      sql`IF(${isActive}, CONCAT_WS(':', ${userId}, ${roleId}, COALESCE(${resultTypeKey}, ''), COALESCE(${programId}, '')), NULL)`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    index('idx_role_assignments_user_active').on(t.userId, t.isActive),
    uniqueIndex('uq_role_assignments_active_key').on(t.activeKey),
    // At most one scope column (the role-vs-scope rule lives in the repository, DD-8).
    check(
      'chk_role_assignments_one_scope',
      sql`${resultTypeKey} IS NULL OR ${programId} IS NULL`,
    ),
    // Active: no revocation data. Inactive: revoked_at and revoked_by both set.
    check(
      'chk_role_assignments_revocation',
      sql`(${isActive} = 1 AND ${revokedAt} IS NULL AND ${revokedBy} IS NULL) OR (${isActive} = 0 AND ${revokedAt} IS NOT NULL AND ${revokedBy} IS NOT NULL)`,
    ),
  ],
);

export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type NewRoleAssignment = typeof roleAssignments.$inferInsert;
