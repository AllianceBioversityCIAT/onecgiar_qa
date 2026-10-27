import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  int,
  mysqlEnum,
  mysqlTable,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { RomeMinute } from '../../../admin-config/rome-date.js';
import { timelines } from './timelines.js';

export const stepAudiences = [
  'assessors',
  'programs',
  'lead_assessors',
  'tpb',
  'ppu',
] as const;
export type StepAudience = (typeof stepAudiences)[number];

const position = sql.identifier('position');
const opensAt = sql.identifier('opens_at');
const closesAt = sql.identifier('closes_at');
const round = sql.identifier('round');
const requiresLoad = sql.identifier('requires_load');

// A step boundary: a DATETIME holding Rome wall-clock time to the minute
// (S-7, DD-1). The database form is `YYYY-MM-DD HH:mm:00`; the application form
// is the branded `RomeMinute`, `YYYY-MM-DDTHH:mm` (DD-3). The mysql2 session
// hands DATETIME over as a string (P-2: `typeCast` -> `field.string()`), so no
// `Date` and no process zone is ever involved.
const romeMinute = customType<{ data: RomeMinute; driverData: string }>({
  dataType() {
    return 'datetime';
  },
  fromDriver(value) {
    return value.slice(0, 16).replace(' ', 'T') as RomeMinute;
  },
  toDriver(value) {
    return `${value.replace('T', ' ')}:00`;
  },
});

// A step of a timeline (design 5, FR-7..FR-10). Cross-step rules (order, no
// overlap, contiguous rounds, audience order) span rows, so
// `timeline-rules.ts` checks them before the insert; the CHECKs below hold
// what one row can say by itself.
export const timelineSteps = mysqlTable(
  'timeline_steps',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    timelineId: int('timeline_id', { unsigned: true })
      .notNull()
      .references(() => timelines.id),
    position: tinyint('position', { unsigned: true }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    audience: mysqlEnum('audience', stepAudiences).notNull(),
    opensAt: romeMinute('opens_at').notNull(),
    closesAt: romeMinute('closes_at').notNull(),
    round: tinyint('round', { unsigned: true }).notNull(),
    requiresLoad: boolean('requires_load').notNull(),
  },
  (t) => [
    unique('uq_timeline_steps_position').on(t.timelineId, t.position),
    unique('uq_timeline_steps_audience').on(t.timelineId, t.audience),
    check('chk_timeline_steps_position', sql`${position} BETWEEN 1 AND 5`),
    // A step closes strictly after it opens; the same day is fine (FR-3).
    check('chk_timeline_steps_dates', sql`${closesAt} > ${opensAt}`),
    check('chk_timeline_steps_round', sql`${round} >= 1`),
    // The first step always requires a load; the database refuses a row that
    // says otherwise instead of switching it on (FR-9).
    check(
      'chk_timeline_steps_first_load',
      sql`${position} <> 1 OR ${requiresLoad}`,
    ),
  ],
);

export type TimelineStep = typeof timelineSteps.$inferSelect;
export type NewTimelineStep = typeof timelineSteps.$inferInsert;
