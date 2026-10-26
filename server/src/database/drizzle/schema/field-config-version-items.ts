import {
  boolean,
  check,
  foreignKey,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  fieldConfigFlagsCheck,
  fieldConfigVisibilities,
} from './field-config-draft-items.js';
import { fieldConfigVersions } from './field-config-versions.js';

// One option set of a published version, for every applicable field at publish
// time, unclassified ones stored as hidden (field-configuration design 5, DD-2,
// DD-3). Append-only on purpose: no update columns, so a later catalog or
// draft change cannot alter a published version (FR-12). The same FR-4 CHECK as
// the draft protects every published row.
export const fieldConfigVersionItems = mysqlTable(
  'field_config_version_items',
  {
    versionId: int('version_id', { unsigned: true }).notNull(),
    resultTypeKey: varchar('result_type_key', { length: 64 }).notNull(),
    fieldKey: varchar('field_key', { length: 128 }).notNull(),
    visibility: mysqlEnum('visibility', fieldConfigVisibilities).notNull(),
    isCore: boolean('is_core').notNull(),
    isAiInput: boolean('is_ai_input').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'field_config_version_items_pk',
      columns: [t.versionId, t.resultTypeKey, t.fieldKey],
    }),
    // Named by hand: the generated name
    // (`field_config_version_items_version_id_field_config_versions_id_fk`)
    // is 65 characters and MySQL allows 64.
    foreignKey({
      name: 'field_config_version_items_version_fk',
      columns: [t.versionId],
      foreignColumns: [fieldConfigVersions.id],
    }),
    check('chk_field_config_version_items_flags', fieldConfigFlagsCheck),
  ],
);

export type FieldConfigVersionItem =
  typeof fieldConfigVersionItems.$inferSelect;
export type NewFieldConfigVersionItem =
  typeof fieldConfigVersionItems.$inferInsert;
