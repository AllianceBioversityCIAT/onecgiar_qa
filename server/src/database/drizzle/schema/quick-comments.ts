// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  int,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

// A reusable comment text per role (step-1-assessment design 5, FR-12).
// `body_hash` is the sha-256 of the trimmed body; the unique key makes a
// repeated save a 1062 that the store turns into the existing row.
export const quickComments = mysqlTable(
  'quick_comments',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    roleCode: varchar('role_code', { length: 32 }).notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    bodyHash: char('body_hash', { length: 64 }).notNull(),
    createdBy: int('created_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [unique('uq_quick_comments_role_hash').on(t.roleCode, t.bodyHash)],
);

export type QuickComment = typeof quickComments.$inferSelect;
export type NewQuickComment = typeof quickComments.$inferInsert;
