import { int, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
import { timelines } from './timelines.js';

// Result types a timeline accepts (design 5, DD-6). Rows exist only while
// `timelines.all_result_types` is false. `result_type_key` is the catalog key,
// as in `role_assignments`, so it carries no FK.
export const timelineResultTypes = mysqlTable(
  'timeline_result_types',
  {
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    resultTypeKey: varchar('result_type_key', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.timelineId, t.resultTypeKey] })],
);

export type TimelineResultType = typeof timelineResultTypes.$inferSelect;
export type NewTimelineResultType = typeof timelineResultTypes.$inferInsert;
