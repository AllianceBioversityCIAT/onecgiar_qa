// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments, commentStates } from './assessment-comments.js';
import { users } from './users.js';

// Append-only record of every applied comment transition (ADR-006). Rows are
// inserted in the transition's transaction and never changed.
export const commentEvents = mysqlTable('comment_events', {
  id: bigint('id', { mode: 'number', unsigned: true })
    .autoincrement()
    .primaryKey(),
  commentId: bigint('comment_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => assessmentComments.id),
  actorId: int('actor_id', { unsigned: true })
    .notNull()
    .references(() => users.id),
  actorRole: varchar('actor_role', { length: 32 }).notNull(),
  // NULL for the first state of a comment.
  fromState: mysqlEnum('from_state', commentStates),
  toState: mysqlEnum('to_state', commentStates).notNull(),
  createdAt: datetime('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type CommentEvent = typeof commentEvents.$inferSelect;
export type NewCommentEvent = typeof commentEvents.$inferInsert;
