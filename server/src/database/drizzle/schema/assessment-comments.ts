// @akili-spec assessment/step-1-assessment
// @akili-spec escalation/round-2
// @akili-spec admin/acts-as-reviewer
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  datetime,
  foreignKey,
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
  // Round 2 (escalation/round-2 FR-8, DD-6): the Lead agrees with the program; closed.
  'lead_sided_program',
] as const;
export type CommentState = (typeof commentStates)[number];

/** `{ value, labels }` of the field, cut when over the size limit (NFR-7). */
export type CommentValueCopy = { value: unknown; labels?: unknown };

const withdrawnAt = sql.identifier('withdrawn_at');
const state = sql.identifier('state');
const valueCopy = sql.identifier('value_copy');
const deletedAt = sql.identifier('deleted_at');
const deletedBy = sql.identifier('deleted_by');

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
    // Soft delete (escalation/round-2 FR-10). A deleted comment keeps its state.
    deletedAt: datetime('deleted_at'),
    deletedBy: int('deleted_by', { unsigned: true }),
    // admin/acts-as-reviewer R4: written by a QA Admin acting as the comment's role.
    actedAsAdmin: boolean('acted_as_admin').notNull().default(false),
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
    foreignKey({
      name: 'fk_assessment_comments_deleted_by',
      columns: [t.deletedBy],
      foreignColumns: [users.id],
    }),
    check(
      'chk_comment_deleted',
      sql`(${deletedAt} IS NULL AND ${deletedBy} IS NULL) OR (${deletedAt} IS NOT NULL AND ${deletedBy} IS NOT NULL)`,
    ),
  ],
);

export type AssessmentComment = typeof assessmentComments.$inferSelect;
export type NewAssessmentComment = typeof assessmentComments.$inferInsert;
