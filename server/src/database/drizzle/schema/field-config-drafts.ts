import { sql } from 'drizzle-orm';
import { check, datetime, int, mysqlTable } from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import { users } from './users.js';

const updatedAt = sql.identifier('updated_at');
const updatedBy = sql.identifier('updated_by');

// The one working draft of a cycle's field configuration (field-configuration
// design 5, FR-5). The row is created by the first draft write (upsert, DD-10),
// not with the cycle, so a cycle with no row reads as an empty draft. `revision`
// is the optimistic guard of FR-8 / DD-6: it starts at 0 and only the draft
// write and the conditional publish update move it.
export const fieldConfigDrafts = mysqlTable(
  'field_config_drafts',
  {
    cycleId: int('cycle_id', { unsigned: true })
      .primaryKey()
      .references(() => cycles.id),
    revision: int('revision', { unsigned: true }).notNull().default(0),
    // Last edit only: both set once the draft has been written, or both NULL.
    updatedAt: datetime('updated_at'),
    updatedBy: int('updated_by', { unsigned: true }).references(() => users.id),
  },
  () => [
    // A draft write always says who and when (pattern of chk_timelines_updated).
    check(
      'chk_field_config_drafts_updated',
      sql`(${updatedAt} IS NULL AND ${updatedBy} IS NULL) OR (${updatedAt} IS NOT NULL AND ${updatedBy} IS NOT NULL)`,
    ),
  ],
);

export type FieldConfigDraft = typeof fieldConfigDrafts.$inferSelect;
export type NewFieldConfigDraft = typeof fieldConfigDrafts.$inferInsert;
