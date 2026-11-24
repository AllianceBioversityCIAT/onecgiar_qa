import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { cycles } from './cycles.js';
import type { FieldConfigVisibility } from './field-config-draft-items.js';
import { fieldConfigVersions } from './field-config-versions.js';
import { users } from './users.js';

export const fieldConfigAuditActions = ['publish'] as const;
export type FieldConfigAuditAction = (typeof fieldConfigAuditActions)[number];

// The option set of one field, as the audit stores it (design 6 `OptionSet`).
export type FieldConfigOptionSet = {
  visibility: FieldConfigVisibility;
  isCore: boolean;
  isAiInput: boolean;
};

// `{ "<resultTypeKey>.<fieldKey>": { before, after } }` for each changed field
// only; `before` is null when the field was unclassified (design 5, FR-11).
export type FieldConfigAuditChanges = Record<
  string,
  { before: FieldConfigOptionSet | null; after: FieldConfigOptionSet }
>;

// The timelines the publication reached (design 5, DD-7): those that receive
// the new version, and those that keep theirs with the version they keep.
// `version` is null for a started timeline that resolves to no version, as the
// preview lists it (DD-7: the record is what the ADMIN saw).
export type FieldConfigAuditTimelines = {
  receive: number[];
  keep: { id: number; version: number | null }[];
};

// Append-only record of every publication (field-configuration FR-11, NFR-8),
// same shape as `timeline_audit_events`. Inserted in the publish transaction and
// never changed: no update columns on purpose.
export const fieldConfigAuditEvents = mysqlTable(
  'field_config_audit_events',
  {
    id: bigint('id', { mode: 'number', unsigned: true })
      .autoincrement()
      .primaryKey(),
    cycleId: int('cycle_id', { unsigned: true })
      .notNull()
      .references(() => cycles.id),
    // The version the publication created.
    versionId: int('version_id', { unsigned: true })
      .notNull()
      .references(() => fieldConfigVersions.id),
    actorId: int('actor_id', { unsigned: true })
      .notNull()
      .references(() => users.id),
    action: mysqlEnum('action', fieldConfigAuditActions).notNull(),
    changes: json('changes').$type<FieldConfigAuditChanges>().notNull(),
    timelines: json('timelines').$type<FieldConfigAuditTimelines>().notNull(),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: datetime('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // One record per publication (FR-11, NFR-8): a second record for the same
    // version, e.g. from a replay, is refused by the database.
    unique('uq_field_config_audit_events_version').on(t.versionId),
    index('idx_field_config_audit_events_cycle_created').on(
      t.cycleId,
      t.createdAt,
    ),
  ],
);

export type FieldConfigAuditEvent = typeof fieldConfigAuditEvents.$inferSelect;
export type NewFieldConfigAuditEvent =
  typeof fieldConfigAuditEvents.$inferInsert;
