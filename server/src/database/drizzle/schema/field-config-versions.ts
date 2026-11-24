import {
  datetime,
  index,
  int,
  mysqlTable,
  smallint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import { users } from './users.js';

// A published version of a cycle's field configuration (field-configuration
// design 5, FR-8, FR-9, FR-12). Append-only on purpose: no update columns, the
// row is inserted by the publication and never changed or deleted. `number`
// counts the cycle's versions from 1.
export const fieldConfigVersions = mysqlTable(
  'field_config_versions',
  {
    id: int('id', { unsigned: true }).autoincrement().primaryKey(),
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    number: smallint('number', { unsigned: true }).notNull(),
    // Version of the Reporting catalog the publication was built from.
    catalogVersion: varchar('catalog_version', { length: 32 }).notNull(),
    // The instant DD-5 compares with a timeline's start (Rome date).
    publishedAt: datetime('published_at').notNull(),
    publishedBy: int('published_by', { unsigned: true })
      .notNull()
      .references(() => users.id),
    requestId: varchar('request_id', { length: 64 }),
  },
  (t) => [
    // Database backstop for DD-6 / FR-8: two concurrent publications cannot
    // both create version N, whatever the pre-read said.
    unique('uq_field_config_versions_cycle_number').on(t.cycleId, t.number),
    index('idx_field_config_versions_cycle_published').on(
      t.cycleId,
      t.publishedAt,
    ),
  ],
);

export type FieldConfigVersion = typeof fieldConfigVersions.$inferSelect;
export type NewFieldConfigVersion = typeof fieldConfigVersions.$inferInsert;
