import { sql } from 'drizzle-orm';
import {
  check,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const exclusionOrigins = ['manual', 'reporting'] as const;
export type ExclusionOrigin = (typeof exclusionOrigins)[number];
export const exclusionStatuses = ['active', 'removed', 'dismissed'] as const;
export type ExclusionStatus = (typeof exclusionStatuses)[number];

// Column names are written unqualified inside the generated column and the
// CHECKs so the emitted SQL carries no `table`.`column` prefix there.
const userId = sql.identifier('user_id');
const programId = sql.identifier('program_id');
const origin = sql.identifier('origin');
const status = sql.identifier('status');
const reason = sql.identifier('reason');
const endedAt = sql.identifier('ended_at');
const endedBy = sql.identifier('ended_by');
const endReason = sql.identifier('end_reason');

// Programs a user may NOT work on (design 5, DD-5). Rows are never deleted:
// removal or dismissal flips `status` and keeps who/when/why.
export const userProgramExclusions = mysqlTable(
  'user_program_exclusions',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    userId: int('user_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    programId: int('program_id', { unsigned: true }).notNull(),
    origin: mysqlEnum('origin', exclusionOrigins).notNull(),
    status: mysqlEnum('status', exclusionStatuses).notNull().default('active'),
    reason: varchar('reason', { length: 500 }),
    // The role Reporting gave the user on the program (origin `reporting`).
    reportingRole: varchar('reporting_role', { length: 100 }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // null = created by the system (a Reporting sync).
    createdBy: int('created_by', { unsigned: true }).references(() => users.id),
    endedAt: datetime('ended_at'),
    // null = ended by the system (a Reporting sync).
    endedBy: int('ended_by', { unsigned: true }).references(() => users.id),
    endReason: varchar('end_reason', { length: 500 }),
    // Identity of an ACTIVE exclusion; NULL once removed or dismissed, so a
    // finished row never blocks a new exclusion of the same program.
    activeKey: varchar('active_key', { length: 64 }).generatedAlwaysAs(
      sql`IF(${status} = 'active', CONCAT_WS(':', ${userId}, ${programId}), NULL)`,
      { mode: 'stored' },
    ),
  },
  (t) => [
    uniqueIndex('uq_user_program_exclusions_active_key').on(t.activeKey),
    // A manual exclusion always carries its reason (FR-4).
    check(
      'chk_user_program_exclusions_manual_reason',
      sql`${origin} <> 'manual' OR (${reason} IS NOT NULL AND TRIM(${reason}) <> '')`,
    ),
    // Only a Reporting exclusion can be dismissed, and never without a reason.
    check(
      'chk_user_program_exclusions_dismissed',
      sql`${status} <> 'dismissed' OR (${origin} = 'reporting' AND ${endReason} IS NOT NULL AND TRIM(${endReason}) <> '')`,
    ),
    // Active: no end data. Removed/dismissed: ended_at set. ended_by NULL means
    // "ended by the system" and is allowed only for a reporting removal; a
    // manual removal and every dismissal need an actor (DD-12).
    check(
      'chk_user_program_exclusions_ended',
      sql`(${status} = 'active' AND ${endedAt} IS NULL AND ${endedBy} IS NULL AND ${endReason} IS NULL) OR (${status} <> 'active' AND ${endedAt} IS NOT NULL AND (${endedBy} IS NOT NULL OR (${origin} = 'reporting' AND ${status} = 'removed')))`,
    ),
  ],
);

export type UserProgramExclusion = typeof userProgramExclusions.$inferSelect;
export type NewUserProgramExclusion = typeof userProgramExclusions.$inferInsert;
