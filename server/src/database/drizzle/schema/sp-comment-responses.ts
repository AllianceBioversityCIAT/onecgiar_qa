// P2-3911 (SP view): what a Science Program answered to a QA comment. Append
// only: a changed answer is a new row, the latest row counts, the others are
// the history. The responder is the Reporting user of the SP session (no QA
// user row), so name and email are copied here (AC12).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  datetime,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments } from './assessment-comments.js';

export const spResponseKinds = [
  'accept',
  'accept_with_comment',
  'disagree',
  'request_clarification',
] as const;
export type SpResponseKind = (typeof spResponseKinds)[number];

const kind = sql.identifier('kind');
const body = sql.identifier('body');

export const spCommentResponses = mysqlTable(
  'sp_comment_responses',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    commentId: bigint('comment_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    kind: mysqlEnum('kind', spResponseKinds).notNull(),
    body: varchar('body', { length: 2000 }),
    responderName: varchar('responder_name', { length: 200 }).notNull(),
    responderEmail: varchar('responder_email', { length: 320 }).notNull(),
    programId: int('program_id', { unsigned: true }).notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [
    index('idx_sp_comment_responses_comment').on(t.commentId, t.id),
    foreignKey({
      name: 'fk_sp_responses_comment',
      columns: [t.commentId],
      foreignColumns: [assessmentComments.id],
    }),
    // A plain accept carries no text; every other kind must.
    check(
      'chk_sp_responses_body',
      sql`(${kind} = 'accept' AND ${body} IS NULL) OR (${kind} <> 'accept' AND ${body} IS NOT NULL)`,
    ),
  ],
);

export type SpCommentResponse = typeof spCommentResponses.$inferSelect;
export type NewSpCommentResponse = typeof spCommentResponses.$inferInsert;
