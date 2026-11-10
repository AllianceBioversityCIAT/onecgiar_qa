// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  tinyint,
  varchar,
} from 'drizzle-orm/mysql-core';
import { resultAssessments } from './result-assessments.js';
import { users } from './users.js';

// Every state of the TRD 7.3 comment machine is declared (DD-10), so
// P2-3911 adds transitions and never a migration. Only `open` and `withdrawn`
// are reachable in step-1-assessment.
export const commentStates = [
  'open',
  'withdrawn',
  'clarification_requested',
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'escalated',
  'tpb_sided_program',
  'tpb_sided_assessor',
  'done',
] as const;
export type CommentState = (typeof commentStates)[number];

/** `{ value, labels }` of the field, cut when over the size limit (NFR-7). */
export type CommentValueCopy = { value: unknown; labels?: unknown };

const withdrawnAt = sql.identifier('withdrawn_at');
const state = sql.identifier('state');
const valueCopy = sql.identifier('value_copy');

// A field comment of an assessment (step-1-assessment design 5, FR-11, FR-13,
// FR-19, NFR-7).
export const assessmentComments = mysqlTable(
  'assessment_comments',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    assessmentId: bigint('assessment_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => resultAssessments.id),
    fieldKey: varchar('field_key', { length: 200 }).notNull(),
    authorId: int('author_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    stepPosition: tinyint('step_position', { unsigned: true }).notNull(),
    round: tinyint('round', { unsigned: true }).notNull(),
    body: varchar('body', { length: 2000 }).notNull(),
    valueCopy: json('value_copy').$type<CommentValueCopy>().notNull(),
    valueTruncated: boolean('value_truncated').notNull().default(false),
    state: mysqlEnum('state', commentStates).notNull().default('open'),
    visibleToProgramAt: datetime('visible_to_program_at'),
    withdrawnAt: datetime('withdrawn_at'),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index('idx_assessment_comments_assessment_field').on(
      t.assessmentId,
      t.fieldKey,
    ),
    check(
      'chk_comment_withdrawn',
      sql`(${withdrawnAt} IS NULL AND ${state} <> 'withdrawn') OR (${withdrawnAt} IS NOT NULL AND ${state} = 'withdrawn')`,
    ),
    // 65536 = 64 KiB, the NFR-7 limit on one stored value copy.
    check('chk_value_copy_size', sql`LENGTH(${valueCopy}) <= 65536`),
  ],
);

export type AssessmentComment = typeof assessmentComments.$inferSelect;
export type NewAssessmentComment = typeof assessmentComments.$inferInsert;
