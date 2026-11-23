// @akili-spec escalation/round-2
// @akili-spec admin/acts-as-reviewer
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  datetime,
  foreignKey,
  int,
  mysqlEnum,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments } from './assessment-comments.js';
import { resultAssessments } from './result-assessments.js';
import { users } from './users.js';

// TPB and PPU values are declared now so those roles add no migration
// (escalation/round-2 design 12).
export const commentDecisionKinds = [
  'agree_program',
  'escalate',
  'tpb_agree_program',
  'tpb_agree_assessor',
  'ppu_done',
] as const;
export type CommentDecisionKind = (typeof commentDecisionKinds)[number];

const body = sql.identifier('body');
const decision = sql.identifier('decision');

// One decision per comment and role (escalation/round-2 FR-8, FR-9, design 5).
// A row is changeable only while its `assessment_id` row is `pending`; its
// history is in `assessment_audit_events`. `assessment_id` is the deciding
// role's assessment. Only `ppu_done` may have no text.
export const commentDecisions = mysqlTable(
  'comment_decisions',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    commentId: bigint('comment_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    assessmentId: bigint('assessment_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    roleCode: varchar('role_code', { length: 32 }).notNull(),
    decision: mysqlEnum('decision', commentDecisionKinds).notNull(),
    body: varchar('body', { length: 2000 }),
    decidedBy: int('decided_by', { unsigned: true }).notNull(),
    // admin/acts-as-reviewer R4: set by a QA Admin acting as the role.
    actedAsAdmin: boolean('acted_as_admin').notNull().default(false),
    decidedAt: datetime('decided_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique('uq_comment_decisions_comment_role').on(t.commentId, t.roleCode),
    foreignKey({
      name: 'fk_comment_decisions_comment',
      columns: [t.commentId],
      foreignColumns: [assessmentComments.id],
    }),
    foreignKey({
      name: 'fk_comment_decisions_assessment',
      columns: [t.assessmentId],
      foreignColumns: [resultAssessments.id],
    }),
    foreignKey({
      name: 'fk_comment_decisions_decided_by',
      columns: [t.decidedBy],
      foreignColumns: [users.id],
    }),
    check(
      'chk_comment_decisions_body',
      sql`${body} IS NOT NULL OR ${decision} = 'ppu_done'`,
    ),
  ],
);

export type CommentDecision = typeof commentDecisions.$inferSelect;
export type NewCommentDecision = typeof commentDecisions.$inferInsert;
