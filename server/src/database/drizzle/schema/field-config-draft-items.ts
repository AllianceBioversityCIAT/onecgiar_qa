import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';

export const fieldConfigVisibilities = [
  'hidden',
  'view_only',
  'assessed',
] as const;
export type FieldConfigVisibility = (typeof fieldConfigVisibilities)[number];

// Unqualified on purpose (MySQL rejects qualified names in a CHECK).
const isCore = sql.identifier('is_core');
const isAiInput = sql.identifier('is_ai_input');
const visibility = sql.identifier('visibility');

// The FR-4 rule, shared by the draft and by every published version: core and
// AI input are possible only on an assessed field. Written once so the two
// tables cannot drift apart.
export const fieldConfigFlagsCheck = sql`(${isCore} = 0 AND ${isAiInput} = 0) OR ${visibility} = 'assessed'`;

// One option set of the draft, per (cycle, result type, field) (design 5,
// FR-4, FR-5). A field with no row is unclassified. Rows are replaced by draft
// writes and deleted by a discard (FR-6); they are not append-only.
export const fieldConfigDraftItems = mysqlTable(
  'field_config_draft_items',
  {
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    resultTypeKey: varchar('result_type_key', { length: 64 }).notNull(),
    fieldKey: varchar('field_key', { length: 128 }).notNull(),
    visibility: mysqlEnum('visibility', fieldConfigVisibilities).notNull(),
    // No default on the flags on purpose: a missing flag is refused, never read
    // as false. The service writes both explicitly (FR-4 "Switching off").
    isCore: boolean('is_core').notNull(),
    isAiInput: boolean('is_ai_input').notNull(),
  },
  (t) => [
    // The composite key is named: the default name would be longer than the 64
    // characters MySQL allows for the version-items twin of this table.
    primaryKey({
      name: 'field_config_draft_items_pk',
      columns: [t.cycleId, t.resultTypeKey, t.fieldKey],
    }),
    check('chk_field_config_draft_items_flags', fieldConfigFlagsCheck),
  ],
);

export type FieldConfigDraftItem = typeof fieldConfigDraftItems.$inferSelect;
export type NewFieldConfigDraftItem = typeof fieldConfigDraftItems.$inferInsert;
