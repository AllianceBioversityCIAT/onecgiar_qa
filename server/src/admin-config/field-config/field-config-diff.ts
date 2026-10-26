// Pure diff of a field-configuration publication (design 7.1, 5, FR-7, FR-8,
// FR-11). `diffConfig` compares the effective draft with the latest version
// over the applicable fields of the catalog, so a draft or version row whose
// field left the catalog is out of the diff (S-7, DD-12). An unclassified
// field reads `hidden` on both sides (glossary, DD-2); that is what makes the
// first publication (no version) list only what the draft classifies above
// hidden. The empty result means "nothing to publish" (S-9).

import { applicableFields, type FieldCatalog } from './field-config-catalog.js';
import type { FieldVisibility } from './field-config-rules.js';

export interface OptionSet {
  visibility: FieldVisibility;
  isCore: boolean;
  isAiInput: boolean;
}

export interface ConfigItem extends OptionSet {
  resultTypeKey: string;
  fieldKey: string;
}

export interface FieldChange {
  resultTypeKey: string;
  fieldKey: string;
  before: OptionSet | null;
  after: OptionSet;
}

const HIDDEN: OptionSet = {
  visibility: 'hidden',
  isCore: false,
  isAiInput: false,
};

const keyOf = (type: string, field: string) => JSON.stringify([type, field]);

function optionSetOf(item: ConfigItem): OptionSet {
  return {
    visibility: item.visibility,
    isCore: item.isCore,
    isAiInput: item.isAiInput,
  };
}

function same(a: OptionSet, b: OptionSet): boolean {
  return (
    a.visibility === b.visibility &&
    a.isCore === b.isCore &&
    a.isAiInput === b.isAiInput
  );
}

/**
 * The (type, field) entries whose effective option set differs, in catalog
 * order (types, then section and field order). `before` is the latest
 * version's row, `null` when it has none (no version, or the field is new);
 * the comparison reads that absence as `hidden`.
 */
export function diffConfig(
  draft: readonly ConfigItem[],
  latest: readonly ConfigItem[] | null,
  catalog: FieldCatalog,
): FieldChange[] {
  const draftBy = new Map(
    draft.map((i) => [keyOf(i.resultTypeKey, i.fieldKey), optionSetOf(i)]),
  );
  const latestBy = new Map(
    (latest ?? []).map((i) => [
      keyOf(i.resultTypeKey, i.fieldKey),
      optionSetOf(i),
    ]),
  );

  const changes: FieldChange[] = [];
  for (const type of catalog.resultTypes) {
    for (const field of applicableFields(catalog, type.key)) {
      const key = keyOf(type.key, field.key);
      const before = latestBy.get(key) ?? null;
      const after = draftBy.get(key) ?? HIDDEN;
      if (!same(before ?? HIDDEN, after)) {
        changes.push({
          resultTypeKey: type.key,
          fieldKey: field.key,
          before,
          after,
        });
      }
    }
  }
  return changes;
}
