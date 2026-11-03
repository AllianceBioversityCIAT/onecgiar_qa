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
import { timelines } from './timelines.js';
import { users } from './users.js';

export const timelineAuditActions = ['update'] as const;
export type TimelineAuditAction = (typeof timelineAuditActions)[number];

// `{ field: { before, after } }` for each field the edit changed; step fields
// are keyed `steps.<position>.<field>` (timeline-edit design 5).
export type TimelineAuditChanges = Record<
  string,
  { before: unknown; after: unknown }
>;

// Append-only record of every applied timeline edit (timeline-edit FR-10,
// DD-10, NFR-8), same shape as `user_audit_events` (P-9). No update columns on
// purpose: rows are inserted in the edit's transaction and never changed.
export const timelineAuditEvents = mysqlTable(
  'timeline_audit_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    // The timeline the edit applies to.
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    actorId: int('actor_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    action: mysqlEnum('action', timelineAuditActions).notNull(),
    changes: json('changes').$type<TimelineAuditChanges>().notNull(),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_timeline_audit_events_timeline_created').on(
      t.timelineId,
      t.createdAt,
    ),
  ],
);

export type TimelineAuditEvent = typeof timelineAuditEvents.$inferSelect;
export type NewTimelineAuditEvent = typeof timelineAuditEvents.$inferInsert;
