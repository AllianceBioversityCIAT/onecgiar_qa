// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { resultAssessments } from './result-assessments.js';
import { users } from './users.js';

export const assessmentAuditActions = [
  'validate',
  'unvalidate',
  'check_all',
  'uncheck_all',
  'comment_add',
  'comment_withdraw',
  'quick_comment_save',
  'end_quality_assessed',
  'end_returned',
  'release_sent',
  'release_refused',
] as const;
export type AssessmentAuditAction = (typeof assessmentAuditActions)[number];

// Append-only record of assessment writes (step-1-assessment FR-21). It never
// carries a comment body or a field value (NFR-5): only keys and ids. No update
// columns on purpose.
export const assessmentAuditEvents = mysqlTable('assessment_audit_events', {
  id: bigint('id', { mode: 'number', unsigned: true })
    .autoincrement()
    .primaryKey(),
  assessmentId: bigint('assessment_id', {
    mode: 'number',
    unsigned: true,
  }).references(() => resultAssessments.id),
  actorId: int('actor_id', { unsigned: true })
    .notNull()
    .references(() => users.id),
  action: mysqlEnum('action', assessmentAuditActions).notNull(),
  fieldKeys: json('field_keys').$type<string[]>(),
  commentId: bigint('comment_id', { mode: 'number', unsigned: true }),
  requestId: varchar('request_id', { length: 64 }),
  createdAt: datetime('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type AssessmentAuditEvent = typeof assessmentAuditEvents.$inferSelect;
export type NewAssessmentAuditEvent = typeof assessmentAuditEvents.$inferInsert;
