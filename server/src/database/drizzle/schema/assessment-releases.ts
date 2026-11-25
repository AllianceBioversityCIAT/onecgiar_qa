// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { resultAssessments } from './result-assessments.js';

export const releaseOutcomes = ['qaed', 'not_qaed'] as const;
export type ReleaseOutcome = (typeof releaseOutcomes)[number];

export const releaseStatuses = ['pending', 'sent', 'refused'] as const;
export type ReleaseStatus = (typeof releaseStatuses)[number];

// Outbox of the release notice to Reporting (step-1-assessment design 5, FR-18,
// NFR-3). The unique `assessment_id` allows one release per end.
export const assessmentReleases = mysqlTable(
  'assessment_releases',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    assessmentId: bigint('assessment_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => resultAssessments.id),
    timelineResultId: bigint('timeline_result_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    resultId: int('result_id', { unsigned: true }).notNull(),
    phaseYear: smallint('phase_year', { unsigned: true }).notNull(),
    outcome: mysqlEnum('outcome', releaseOutcomes).notNull(),
    status: mysqlEnum('status', releaseStatuses).notNull().default('pending'),
    attempts: tinyint('attempts', { unsigned: true }).notNull().default(0),
    leaseUntil: datetime('lease_until'),
    reason: varchar('reason', { length: 32 }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    sentAt: datetime('sent_at'),
  },
  (t) => [unique('uq_assessment_releases_assessment').on(t.assessmentId)],
);

export type AssessmentRelease = typeof assessmentReleases.$inferSelect;
export type NewAssessmentRelease = typeof assessmentReleases.$inferInsert;
