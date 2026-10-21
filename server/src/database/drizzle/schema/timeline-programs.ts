import { int, mysqlTable, primaryKey } from 'drizzle-orm/mysql-core';
import { timelines } from './timelines.js';

// Programs a timeline accepts (design 5, DD-6). Rows exist only while
// `timelines.all_programs` is false; the service keeps flag and rows in step
// in one transaction (a CHECK cannot span tables). `program_id` is the CLARISA
// id, so it carries no FK.
export const timelinePrograms = mysqlTable(
  'timeline_programs',
  {
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    programId: int('program_id', { unsigned: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.timelineId, t.programId] })],
);

export type TimelineProgram = typeof timelinePrograms.$inferSelect;
export type NewTimelineProgram = typeof timelinePrograms.$inferInsert;
