// @akili-spec ingestion/step-1-loads
import { sql } from 'drizzle-orm';
import {
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import { timelineSteps } from './timeline-steps.js';
import { timelines } from './timelines.js';
import { users } from './users.js';

export const timelineLoadStatuses = ['running', 'completed', 'failed'] as const;
export type TimelineLoadStatus = (typeof timelineLoadStatuses)[number];

// The closed list of design 5.1; the column is free text so a new reason is a
// code change, not a migration.
export const timelineLoadFailureReasons = [
  'REPORTING_UNAUTHORIZED',
  'REPORTING_REJECTED',
  'REPORTING_UNAVAILABLE',
  'CATALOG_VERSION_MISMATCH',
  'STORE_UNAVAILABLE',
  'ABANDONED',
  'INTERNAL',
] as const;
export type TimelineLoadFailureReason =
  (typeof timelineLoadFailureReasons)[number];

// What the load read from the timeline at start (FR-3).
export type TimelineLoadScope = {
  allPrograms: boolean;
  programIds: number[];
  allResultTypes: boolean;
  resultTypeKeys: string[];
};

// Column names are written unqualified inside the generated column so the
// emitted SQL carries no `table`.`column` prefix there (MySQL rejects it).
const status = sql.identifier('status');
const cycleId = sql.identifier('cycle_id');

// A load of one timeline (step-1-loads design 5.1, migration `0007`). Rows are
// never deleted; a run only moves `running` to `completed` or `failed`.
export const timelineLoads = mysqlTable(
  'timeline_loads',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    // Step 1 today; the column leaves room for step 3 (P2-3906).
    timelineStepId: int('timeline_step_id', { unsigned: true })
      .notNull()
      .references(() => timelineSteps.id),
    // `cycles.year` at start.
    phaseYear: smallint('phase_year', { unsigned: true }).notNull(),
    scope: json('scope').$type<TimelineLoadScope>().notNull(),
    status: mysqlEnum('status', timelineLoadStatuses).notNull(),
    // The cycle id while the load is running, NULL otherwise: a unique index
    // over it allows many finished loads but only one running per cycle, under
    // concurrent starts (FR-2, NFR-6, DD-2).
    runningKey: int('running_key', { unsigned: true }).generatedAlwaysAs(
      sql`IF(${status} = 'running', ${cycleId}, NULL)`,
      { mode: 'stored' },
    ),
    // NULL until the run has listed every page.
    total: int('total', { unsigned: true }),
    processed: int('processed', { unsigned: true }).notNull().default(0),
    // Loaded by program and type, KP groups, skips by reason, other timelines.
    summary: json('summary').$type<Record<string, unknown>>(),
    failureReason: varchar('failure_reason', { length: 64 }),
    startedBy: int('started_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    // No default: the lease (DD-6) compares these with the application clock,
    // so the code always sets them.
    startedAt: datetime('started_at').notNull(),
    heartbeatAt: datetime('heartbeat_at').notNull(),
    finishedAt: datetime('finished_at'),
    requestId: varchar('request_id', { length: 64 }),
  },
  (t) => [
    uniqueIndex('uq_timeline_loads_running_key').on(t.runningKey),
    index('idx_timeline_loads_timeline_id').on(t.timelineId, t.id),
  ],
);

export type TimelineLoad = typeof timelineLoads.$inferSelect;
export type NewTimelineLoad = typeof timelineLoads.$inferInsert;
