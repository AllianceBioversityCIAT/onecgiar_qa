// @akili-spec escalation/round-2-ppu
import {
  bigint,
  datetime,
  foreignKey,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { timelineResults } from './timeline-results.js';

// P2-3917 AC6 (DD-P6): the first time the PPU's view saw a case field's
// Reporting value differ from the membership's round-2 snapshot. One row per
// (membership, field); a later sighting keeps the first date
// (`INSERT … ON DUPLICATE KEY UPDATE id = id`). No value is stored: the
// view shows only "Changed in Reporting Tool on <detected_at>".
export const reportingFieldChanges = mysqlTable(
  'reporting_field_changes',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    timelineResultId: bigint('timeline_result_id', {
      mode: 'number',
      unsigned: true,
    }).notNull(),
    fieldKey: varchar('field_key', { length: 200 }).notNull(),
    detectedAt: datetime('detected_at').notNull(),
  },
  (t) => [
    unique('uq_reporting_field_changes_membership_field').on(
      t.timelineResultId,
      t.fieldKey,
    ),
    foreignKey({
      name: 'fk_reporting_field_changes_membership',
      columns: [t.timelineResultId],
      foreignColumns: [timelineResults.id],
    }),
  ],
);

export type ReportingFieldChange = typeof reportingFieldChanges.$inferSelect;
