// @akili-spec assessment/ai-suggestions
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  datetime,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { assessmentComments } from './assessment-comments.js';
import { timelineResults } from './timeline-results.js';

export const aiUsageActions = [
  'shown',
  'copied',
  'comment_saved',
  'validated_above_ai',
] as const;
export type AiUsageAction = (typeof aiUsageActions)[number];

export const aiSignals = ['green', 'amber', 'red'] as const;
export type AiSignal = (typeof aiSignals)[number];

const action = sql.identifier('action');
const reason = sql.identifier('reason');
const aiLevel = sql.identifier('ai_level');
const validatedLevel = sql.identifier('validated_level');

// How a reviewer used an AI suggestion (ai-suggestions design 3, FR-8, AC9).
// It measures the AI, never the reviewers (NFR-3): there is NO user column.
// A row is keyed on the membership and the step (not on `result_assessments`)
// because a suggestion is shown before any write, and a read never creates the
// assessment (step-1-assessment DD-3). `shown`, `copied` and
// `validated_above_ai` are once per (suggestion, membership, step); the
// generated `dedupe_action` is NULL for `comment_saved`, which is once per
// comment instead.
export const aiSuggestionUsage = mysqlTable(
  'ai_suggestion_usage',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    suggestionId: char('suggestion_id', { length: 32 }).notNull(),
    timelineResultId: bigint('timeline_result_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    stepPosition: tinyint('step_position', { unsigned: true }).notNull(),
    roleCode: varchar('role_code', { length: 32 }).notNull(),
    fieldKey: varchar('field_key', { length: 200 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
    signal: mysqlEnum('ai_signal', aiSignals).notNull(),
    action: mysqlEnum('action', aiUsageActions).notNull(),
    dedupeAction: varchar('dedupe_action', { length: 32 }).generatedAlwaysAs(
      sql`IF(${action} = 'comment_saved', NULL, ${action})`,
      { mode: 'stored' },
    ),
    commentId: bigint('comment_id', { mode: 'number', unsigned: true }),
    edited: boolean('edited'),
    aiLevel: tinyint('ai_level', { unsigned: true }),
    reportedLevel: tinyint('reported_level', { unsigned: true }),
    validatedLevel: tinyint('validated_level', { unsigned: true }),
    reason: varchar('reason', { length: 200 }),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    unique('uq_ai_usage_once').on(
      t.suggestionId,
      t.timelineResultId,
      t.stepPosition,
      t.dedupeAction,
    ),
    unique('uq_ai_usage_comment').on(t.commentId),
    index('idx_ai_usage_suggestion').on(t.suggestionId, t.action),
    index('idx_ai_usage_field').on(t.fieldKey, t.promptVersion, t.action),
    foreignKey({
      name: 'fk_ai_usage_membership',
      columns: [t.timelineResultId],
      foreignColumns: [timelineResults.id],
    }),
    foreignKey({
      name: 'fk_ai_usage_comment',
      columns: [t.commentId],
      foreignColumns: [assessmentComments.id],
    }),
    check(
      'chk_ai_usage_above',
      sql`${action} <> 'validated_above_ai' OR (${reason} IS NOT NULL AND ${validatedLevel} >= ${aiLevel} + 2)`,
    ),
  ],
);

export type AiSuggestionUsage = typeof aiSuggestionUsage.$inferSelect;
export type NewAiSuggestionUsage = typeof aiSuggestionUsage.$inferInsert;
