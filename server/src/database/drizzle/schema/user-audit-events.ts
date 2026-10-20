import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const userAuditActions = [
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
] as const;
export type UserAuditAction = (typeof userAuditActions)[number];

// `{ field: { before, after } }` for each field the event changed.
export type UserAuditChanges = Record<
  string,
  { before: unknown; after: unknown }
>;

// Append-only record of every change made through the user-management API
// (FR-13). No update columns on purpose: rows are inserted and never changed.
export const userAuditEvents = mysqlTable(
  'user_audit_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    // The user the change applies to.
    userId: int('user_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    actorId: int('actor_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    action: mysqlEnum('action', userAuditActions).notNull(),
    changes: json('changes').$type<UserAuditChanges>().notNull(),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_user_audit_events_user_created').on(t.userId, t.createdAt),
  ],
);

export type UserAuditEvent = typeof userAuditEvents.$inferSelect;
export type NewUserAuditEvent = typeof userAuditEvents.$inferInsert;
