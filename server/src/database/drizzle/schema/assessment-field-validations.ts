// @akili-spec assessment/step-1-assessment
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  foreignKey,
  int,
  mysqlTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/mysql-core';
import { resultAssessments } from './result-assessments.js';
import { users } from './users.js';

// A field's validated flag inside one assessment (step-1-assessment design 5,
// FR-10). Last write wins; every change is audited in
// `assessment_audit_events`.
export const assessmentFieldValidations = mysqlTable(
  'assessment_field_validations',
  {
    assessmentId: bigint('assessment_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    fieldKey: varchar('field_key', { length: 200 }).notNull(),
    validated: boolean('validated').notNull(),
    updatedAt: datetime('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedBy: int('updated_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({
      name: 'pk_assessment_field_validations',
      columns: [t.assessmentId, t.fieldKey],
    }),
    // Named by hand: the generated name is 67 characters and MySQL allows 64.
    foreignKey({
      name: 'fk_assessment_field_validations_assessment',
      columns: [t.assessmentId],
      foreignColumns: [resultAssessments.id],
    }),
  ],
);

export type AssessmentFieldValidation =
  typeof assessmentFieldValidations.$inferSelect;
export type NewAssessmentFieldValidation =
  typeof assessmentFieldValidations.$inferInsert;
