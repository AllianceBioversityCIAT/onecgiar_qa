// P2-3911 (SP view): the assessor's answer to a clarification the program
// requested. One answer per request (`response_id` unique).
import {
  bigint,
  datetime,
  foreignKey,
  int,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments } from './assessment-comments.js';
import { spCommentResponses } from './sp-comment-responses.js';
import { users } from './users.js';

export const commentClarificationAnswers = mysqlTable(
  'comment_clarification_answers',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    commentId: bigint('comment_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    responseId: bigint('response_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    authorId: int('author_id', { unsigned: true }).notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [
    unique('uq_clarification_answers_response').on(t.responseId),
    foreignKey({
      name: 'fk_clarification_answers_comment',
      columns: [t.commentId],
      foreignColumns: [assessmentComments.id],
    }),
    foreignKey({
      name: 'fk_clarification_answers_response',
      columns: [t.responseId],
      foreignColumns: [spCommentResponses.id],
    }),
    foreignKey({
      name: 'fk_clarification_answers_author',
      columns: [t.authorId],
      foreignColumns: [users.id],
    }),
  ],
);

export type CommentClarificationAnswer =
  typeof commentClarificationAnswers.$inferSelect;
