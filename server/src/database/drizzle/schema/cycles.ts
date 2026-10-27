import { sql } from 'drizzle-orm';
import {
  check,
  datetime,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  tinyint,
  unique,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const cycleStatuses = ['draft', 'active', 'closed'] as const;
export type CycleStatus = (typeof cycleStatuses)[number];

// Column names are written unqualified inside the generated column and the
// CHECKs so the emitted SQL carries no `table`.`column` prefix there.
const year = sql.identifier('year');
const status = sql.identifier('status');
const activatedAt = sql.identifier('activated_at');
const activatedBy = sql.identifier('activated_by');
const closedAt = sql.identifier('closed_at');
const closedBy = sql.identifier('closed_by');

// A QA cycle (cycle-timelines design 5, FR-1, FR-3). One row per year; at most
// one is `active` at any moment, enforced by the database (NFR-3).
export const cycles = mysqlTable(
  'cycles',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    year: smallint('year', { unsigned: true }).notNull(),
    status: mysqlEnum('status', cycleStatuses).notNull().default('draft'),
    // 1 while the cycle is active, NULL otherwise: the unique index below
    // allows many NULLs but only one 1, so two active cycles cannot coexist
    // (FR-3).
    activeKey: tinyint('active_key').generatedAlwaysAs(
      sql`IF(${status} = 'active', 1, NULL)`,
      { mode: 'stored' },
    ),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: int('created_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    activatedAt: datetime('activated_at'),
    activatedBy: int('activated_by', { unsigned: true }).references(
      () => users.id,
    ),
    closedAt: datetime('closed_at'),
    closedBy: int('closed_by', { unsigned: true }).references(() => users.id),
  },
  (t) => [
    unique('uq_cycles_year').on(t.year),
    uniqueIndex('uq_cycles_active_key').on(t.activeKey),
    check('chk_cycles_year', sql`${year} BETWEEN 2020 AND 2100`),
    // draft: no lifecycle data. active: activated, not closed. closed: closed
    // (a cycle closed by an activation keeps its own activated_* data).
    check(
      'chk_cycles_lifecycle',
      sql`(${status} = 'draft' AND ${activatedAt} IS NULL AND ${activatedBy} IS NULL AND ${closedAt} IS NULL AND ${closedBy} IS NULL) OR (${status} = 'active' AND ${activatedAt} IS NOT NULL AND ${activatedBy} IS NOT NULL AND ${closedAt} IS NULL AND ${closedBy} IS NULL) OR (${status} = 'closed' AND ${closedAt} IS NOT NULL AND ${closedBy} IS NOT NULL)`,
    ),
  ],
);

export type Cycle = typeof cycles.$inferSelect;
export type NewCycle = typeof cycles.$inferInsert;
