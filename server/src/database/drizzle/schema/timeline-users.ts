import { sql } from 'drizzle-orm';
import {
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
import { timelines } from './timelines.js';
import { users } from './users.js';

const timelineId = sql.identifier('timeline_id');
const userId = sql.identifier('user_id');
const roleId = sql.identifier('role_id');
const removedAt = sql.identifier('removed_at');
const removedBy = sql.identifier('removed_by');

// Users assigned to a timeline in a role (design 5, FR-14, FR-15). A removal
// keeps the row (who and when); the generated key only holds while the row is
// not removed, so a removed row never blocks a re-assignment.
export const timelineUsers = mysqlTable(
  'timeline_users',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    userId: int('user_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    roleId: smallint('role_id', { unsigned: true })
      .notNull()
      .references(() => roles.id),
    assignedAt: datetime('assigned_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    assignedBy: int('assigned_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    removedAt: datetime('removed_at'),
    removedBy: int('removed_by', { unsigned: true }).references(() => users.id),
    // `timeline:user:role` while active, NULL once removed (FR-14: never a
    // second active row; FR-15: re-assign allowed).
    activeKey: varchar('active_key', { length: 64 }).generatedAlwaysAs(
      sql`IF(${removedAt} IS NULL, CONCAT_WS(':', ${timelineId}, ${userId}, ${roleId}), NULL)`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    index('idx_timeline_users_timeline').on(t.timelineId),
    uniqueIndex('uq_timeline_users_active_key').on(t.activeKey),
    // A removal always says who and when.
    check(
      'chk_timeline_users_removed',
      sql`(${removedAt} IS NULL AND ${removedBy} IS NULL) OR (${removedAt} IS NOT NULL AND ${removedBy} IS NOT NULL)`,
    ),
  ],
);

export type TimelineUser = typeof timelineUsers.$inferSelect;
export type NewTimelineUser = typeof timelineUsers.$inferInsert;
