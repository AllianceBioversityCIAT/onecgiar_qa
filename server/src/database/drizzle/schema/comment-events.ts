// @akili-spec assessment/step-1-assessment
// @akili-spec escalation/round-2
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  datetime,
  foreignKey,
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments, commentStates } from './assessment-comments.js';
import { spCommentResponses } from './sp-comment-responses.js';
import { users } from './users.js';

const actorId = sql.identifier('actor_id');
const spResponseId = sql.identifier('sp_response_id');

// Append-only record of every applied comment transition (ADR-006). Rows are
// inserted in the transition's transaction and never changed. A Science
// Program response (P2-3911) has no QA user: `actor_id` is NULL and the row
// points at the `sp_comment_responses` row instead; one of the two is always
// set.
export const commentEvents = mysqlTable(
  'comment_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    commentId: bigint('comment_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => assessmentComments.id),
    actorId: int('actor_id', { unsigned: true }).references(() => users.id),
    actorRole: varchar('actor_role', { length: 32 }).notNull(),
    // NULL for the first state of a comment.
    fromState: mysqlEnum('from_state', commentStates),
    toState: mysqlEnum('to_state', commentStates).notNull(),
    spResponseId: bigint('sp_response_id', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    foreignKey({
      name: 'fk_comment_events_sp_response',
      columns: [t.spResponseId],
      foreignColumns: [spCommentResponses.id],
    }),
    check(
      'chk_comment_events_actor',
      sql`${actorId} IS NOT NULL OR ${spResponseId} IS NOT NULL`,
    ),
  ],
);

export type CommentEvent = typeof commentEvents.$inferSelect;
export type NewCommentEvent = typeof commentEvents.$inferInsert;
