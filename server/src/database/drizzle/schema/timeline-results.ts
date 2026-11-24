// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  uniqueIndex,
  unique,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import { timelineLoads } from './timeline-loads.js';
import { timelines } from './timelines.js';

export const timelineResultStatuses = [
  'pending',
  'auto_validated',
  'not_in_qa',
] as const;
export type TimelineResultStatus = (typeof timelineResultStatuses)[number];

export const timelineResultKpGroups = [
  'not_in_qa',
  'auto_checked',
  'review',
] as const;
export type TimelineResultKpGroup = (typeof timelineResultKpGroups)[number];

export const timelineResultEndReasons = [
  'timeline_closed',
  'released_qaed',
  // Reserved and unwritten (timeline-sync S-7).
  'released_not_qaed',
  // A round-1 membership the program took back (timeline-sync FR-6).
  'returned',
] as const;
export type TimelineResultEndReason = (typeof timelineResultEndReasons)[number];

// Column names are written unqualified inside the generated column so the
// emitted SQL carries no `table`.`column` prefix there (MySQL rejects it).
const endedAt = sql.identifier('ended_at');
const cycleId = sql.identifier('cycle_id');
const resultCode = sql.identifier('result_code');
const entryRound = sql.identifier('entry_round');
const changedFields = sql.identifier('changed_fields');

// A result's membership of a timeline (step-1-loads design 5.2, FR-4, FR-5).
// Rows are never deleted; the only update is ending the membership
// (`ended_at`, `end_reason`). Migration `0008` (timeline-sync design 5.1) adds
// the round, so a result can hold one membership per round in one timeline.
export const timelineResults = mysqlTable(
  'timeline_results',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    loadId: int('load_id', { unsigned: true })
      .notNull()
      .references(() => timelineLoads.id),
    // Identity across phases (S-2) and the phase's own id (FR-5).
    resultCode: int('result_code', { unsigned: true }).notNull(),
    resultId: int('result_id', { unsigned: true }).notNull(),
    phaseYear: smallint('phase_year', { unsigned: true }).notNull(),
    // Lead program.
    programClarisaId: int('program_clarisa_id', { unsigned: true }).notNull(),
    resultTypeKey: varchar('result_type_key', { length: 64 }).notNull(),
    status: mysqlEnum('status', timelineResultStatuses).notNull(),
    // NULL for a non-KP result.
    kpGroup: mysqlEnum('kp_group', timelineResultKpGroups),
    // 3 for a KP result that waits for review (S-9).
    awaitsStep: tinyint('awaits_step', { unsigned: true }),
    // The DynamoDB sort key; the partition key derives from `result_code`.
    snapshotSk: varchar('snapshot_sk', { length: 160 }).notNull(),
    snapshotHash: char('snapshot_hash', { length: 64 }).notNull(),
    catalogVersion: varchar('catalog_version', { length: 32 }).notNull(),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    endedAt: datetime('ended_at'),
    endReason: mysqlEnum('end_reason', timelineResultEndReasons),
    // `cycle#result_code` while the membership is active, NULL once it ended:
    // a unique index over it makes a second active membership of one result in
    // a cycle impossible, even under a race (FR-4, NFR-6, DD-2).
    activeKey: varchar('active_key', { length: 32 }).generatedAlwaysAs(
      sql`IF(${endedAt} IS NULL, CONCAT(${cycleId}, '#', ${resultCode}), NULL)`,
      { mode: 'stored' },
    ),
    // The columns below are last, where migration 0008 adds them.
    // The round of the sync that wrote the row (FR-2); rows from before 0008
    // are round 1.
    entryRound: tinyint('entry_round', { unsigned: true }).notNull().default(1),
    // The membership whose snapshot this one was compared with; NULL when the
    // cycle holds no earlier snapshot of the result (FR-8, DD-5).
    previousMembershipId: bigint('previous_membership_id', {
      mode: 'number',
      unsigned: true,
    }).references((): AnyMySqlColumn => timelineResults.id),
    // Catalog keys whose value changed since `previous_membership_id`: NULL
    // when there is no earlier snapshot, `[]` when nothing changed (FR-8).
    changedFields: json('changed_fields').$type<string[]>(),
  },
  (t) => [
    uniqueIndex('uq_timeline_results_active_key').on(t.activeKey),
    // One membership per result, timeline and round, active or ended: a result
    // re-enters a timeline at most once, in round 2 (FR-5, DD-2). It also
    // covers the `timeline_id` lookups and its foreign key.
    unique('uq_timeline_results_timeline_code_round').on(
      t.timelineId,
      t.resultCode,
      t.entryRound,
    ),
    // History of a result across timelines.
    index('idx_timeline_results_result_code').on(t.resultCode),
    check('chk_timeline_results_entry_round', sql`${entryRound} IN (1, 2)`),
    // 96 = the largest catalog type (70 top-level fields, P-9) rounded up to
    // the next multiple of 32 (NFR-3).
    check(
      'chk_timeline_results_changed_fields',
      sql`${changedFields} IS NULL OR JSON_LENGTH(${changedFields}) <= 96`,
    ),
  ],
);

export type TimelineResult = typeof timelineResults.$inferSelect;
export type NewTimelineResult = typeof timelineResults.$inferInsert;
