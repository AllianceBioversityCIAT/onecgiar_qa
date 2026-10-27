import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  int,
  mysqlEnum,
  mysqlTable,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
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
const opensOn = sql.identifier('opens_on');
const closesOn = sql.identifier('closes_on');
const round = sql.identifier('round');
const requiresLoad = sql.identifier('requires_load');

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
    // Rome calendar days, read and written as `YYYY-MM-DD` strings: a `Date`
    // would go through the server's time zone (DD-5, P-12).
    opensOn: date('opens_on', { mode: 'string' }).notNull(),
    closesOn: date('closes_on', { mode: 'string' }).notNull(),
    round: tinyint('round', { unsigned: true }).notNull(),
    requiresLoad: boolean('requires_load').notNull(),
  },
  (t) => [
    unique('uq_timeline_steps_position').on(t.timelineId, t.position),
    unique('uq_timeline_steps_audience').on(t.timelineId, t.audience),
    check('chk_timeline_steps_position', sql`${position} BETWEEN 1 AND 5`),
    // A step may open and close on the same day (FR-8).
    check('chk_timeline_steps_dates', sql`${closesOn} >= ${opensOn}`),
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
