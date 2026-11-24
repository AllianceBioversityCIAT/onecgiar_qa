import {
  boolean,
  mysqlEnum,
  mysqlTable,
  smallint,
  varchar,
} from 'drizzle-orm/mysql-core';

export const roleScopeTypes = ['global', 'result_type', 'program'] as const;
export type RoleScopeType = (typeof roleScopeTypes)[number];

export const roles = mysqlTable('roles', {
  id: smallint('id', { unsigned: true }).autoincrement().primaryKey(),
  // ADMIN, LEAD_ASSESSOR, ASSESSOR, TPB, PPU, PROGRAM (seeded).
  code: varchar('code', { length: 32 }).notNull().unique('uq_roles_code'),
  name: varchar('name', { length: 100 }).notNull(),
  scopeType: mysqlEnum('scope_type', roleScopeTypes).notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
