import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  unique,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import { users } from './users.js';

// FR-6: a timeline name is unique within its cycle regardless of letter case.
// drizzle mysql-core has no per-column collation option, so the column type
// carries it. The collation is spelled out (MySQL 8's default, which is what
// `users.nickname` gets implicitly) so the uniqueness never depends on the
// database default and `schema.spec.ts` can pin it.
export const TIMELINE_NAME_COLLATION = 'utf8mb4_0900_ai_ci';
const timelineName = customType<{ data: string }>({
  dataType() {
    return `varchar(120) COLLATE ${TIMELINE_NAME_COLLATION}`;
  },
});

export const timelineKinds = ['official', 'additional'] as const;
export type TimelineKind = (typeof timelineKinds)[number];

const kind = sql.identifier('kind');
const cycleId = sql.identifier('cycle_id');

// A QA timeline inside a cycle (design 5, FR-5, FR-6). Official/additional is
// decided by the service (DD-3); the generated key is the database backstop.
export const timelines = mysqlTable(
  'timelines',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    name: timelineName('name').notNull(),
    kind: mysqlEnum('kind', timelineKinds).notNull(),
    // The cycle id while the timeline is official, NULL otherwise: a unique
    // index over it leaves room for many additional timelines but only one
    // official per cycle (FR-5, NFR-3).
    officialKey: int('official_key', { unsigned: true }).generatedAlwaysAs(
      sql`IF(${kind} = 'official', ${cycleId}, NULL)`,
      { mode: 'stored' },
    ),
    // Explicit "all" (DD-6): an empty scope list never means "all". No default
    // on purpose, so a missing value is refused instead of read as false.
    allPrograms: boolean('all_programs').notNull(),
    allResultTypes: boolean('all_result_types').notNull(),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: int('created_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('idx_timelines_cycle').on(t.cycleId),
    unique('uq_timelines_cycle_name').on(t.cycleId, t.name),
    uniqueIndex('uq_timelines_official_key').on(t.officialKey),
  ],
);

export type Timeline = typeof timelines.$inferSelect;
export type NewTimeline = typeof timelines.$inferInsert;
