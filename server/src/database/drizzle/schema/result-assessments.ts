// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { timelineResults } from './timeline-results.js';
import { users } from './users.js';

export const resultAssessmentStatuses = [
  'pending',
  'quality_assessed',
  'returned',
] as const;
export type ResultAssessmentStatus = (typeof resultAssessmentStatuses)[number];

const status = sql.identifier('status');
const finishedAt = sql.identifier('finished_at');
const finishedBy = sql.identifier('finished_by');

// One assessment per membership and step (step-1-assessment design 5, FR-17).
// Finished means `finished_at` and `finished_by` are set and the status is not
// `pending`; the CHECK keeps the three in step.
export const resultAssessments = mysqlTable(
  'result_assessments',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    timelineResultId: bigint('timeline_result_id', {
      mode: 'number',
      unsigned: true,
    })
      .notNull()
      .references(() => timelineResults.id),
    stepPosition: tinyint('step_position', { unsigned: true }).notNull(),
    roleCode: varchar('role_code', { length: 32 }).notNull(),
    status: mysqlEnum('status', resultAssessmentStatuses)
      .notNull()
      .default('pending'),
    // The published field-configuration version the assessment was made under.
    fieldConfigVersion: int('field_config_version', {
      unsigned: true,
    }).notNull(),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: int('created_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    finishedAt: datetime('finished_at'),
    finishedBy: int('finished_by', { unsigned: true }).references(
      () => users.id,
    ),
  },
  (t) => [
    unique('uq_result_assessments_membership_step').on(
      t.timelineResultId,
      t.stepPosition,
    ),
    check(
      'chk_result_assessments_finished',
      sql`(${status} = 'pending' AND ${finishedAt} IS NULL AND ${finishedBy} IS NULL) OR (${status} <> 'pending' AND ${finishedAt} IS NOT NULL AND ${finishedBy} IS NOT NULL)`,
    ),
  ],
);

export type ResultAssessment = typeof resultAssessments.$inferSelect;
export type NewResultAssessment = typeof resultAssessments.$inferInsert;
