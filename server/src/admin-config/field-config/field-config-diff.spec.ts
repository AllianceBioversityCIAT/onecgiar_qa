import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  diffConfig,
  type ConfigItem,
  type OptionSet,
} from './field-config-diff.js';
import { applicableFields, shapeCatalog } from './field-config-catalog.js';

// Fixture: the real Reporting TEST catalog 2026.30 (T-2); fields per type come
// from `applicableFields`. Expected changes are literals from design 5
// (`changes`: before `OptionSet | null`, after `OptionSet`) and FR-7 / FR-11.
const RAW = JSON.parse(
  readFileSync(
    new URL('./fixtures/reporting-qa-catalog-2026.json', import.meta.url),
    'utf8',
  ),
) as { fields: { key: string }[] };
const catalog = shapeCatalog(RAW);

const TYPE = 'policy_change';
const [F1, F2, F3] = applicableFields(catalog, TYPE).map((f) => f.key) as [
  string,
  string,
  string,
];

const HIDDEN: OptionSet = {
  visibility: 'hidden',
  isCore: false,
  isAiInput: false,
};
const VIEW: OptionSet = {
  visibility: 'view_only',
  isCore: false,
  isAiInput: false,
};
const ASSESSED: OptionSet = {
  visibility: 'assessed',
  isCore: false,
  isAiInput: false,
};
const CORE: OptionSet = {
  visibility: 'assessed',
  isCore: true,
  isAiInput: false,
};

const at = (
  resultTypeKey: string,
  fieldKey: string,
  o: OptionSet,
): ConfigItem => ({
  resultTypeKey,
  fieldKey,
  ...o,
});

describe('diffConfig: nothing to publish (FR-7, FR-8, S-9)', () => {
  it('is empty when the draft equals the latest version', () => {
    const same = [at(TYPE, F1, ASSESSED), at(TYPE, F2, VIEW)];
    expect(diffConfig(same, [...same], catalog)).toEqual([]);
  });

  it('is empty with an empty draft and no version: unclassified reads hidden on both sides', () => {
    expect(diffConfig([], null, catalog)).toEqual([]);
  });

  it('an unclassified field reads hidden: a draft that sets hidden equals a version that has none', () => {
    expect(diffConfig([at(TYPE, F1, HIDDEN)], [], catalog)).toEqual([]);
    expect(diffConfig([], [at(TYPE, F1, HIDDEN)], catalog)).toEqual([]);
  });

  it('is empty for a draft that hides what the first publication has nothing for (no version)', () => {
    expect(diffConfig([at(TYPE, F1, HIDDEN)], null, catalog)).toEqual([]);
  });
});

describe('diffConfig: only changed (type, field) entries (FR-11)', () => {
  it('lists the changed field with before and after, and not the unchanged ones', () => {
    const latest = [at(TYPE, F1, VIEW), at(TYPE, F2, ASSESSED)];
    const draft = [at(TYPE, F1, CORE), at(TYPE, F2, ASSESSED)];
    expect(diffConfig(draft, latest, catalog)).toEqual([
      { resultTypeKey: TYPE, fieldKey: F1, before: VIEW, after: CORE },
    ]);
  });

  it('the same field under another type is a separate entry, and only the changed type is listed', () => {
    const latest = [at(TYPE, F1, VIEW), at('knowledge_product', F1, VIEW)];
    const draft = [at(TYPE, F1, VIEW), at('knowledge_product', F1, ASSESSED)];
    expect(diffConfig(draft, latest, catalog)).toEqual([
      {
        resultTypeKey: 'knowledge_product',
        fieldKey: F1,
        before: VIEW,
        after: ASSESSED,
      },
    ]);
  });

  it('a field the draft no longer classifies reads hidden, so it is a change back to hidden', () => {
    expect(diffConfig([], [at(TYPE, F2, VIEW)], catalog)).toEqual([
      { resultTypeKey: TYPE, fieldKey: F2, before: VIEW, after: HIDDEN },
    ]);
  });

  it('lists changes in catalog order (types, then section and field order), not draft order', () => {
    const draft = [at(TYPE, F3, VIEW), at(TYPE, F1, VIEW)];
    expect(diffConfig(draft, null, catalog).map((c) => c.fieldKey)).toEqual([
      F1,
      F3,
    ]);
  });

  it('a field the latest version has no row for has before null', () => {
    expect(
      diffConfig([at(TYPE, F1, ASSESSED)], [at(TYPE, F2, VIEW)], catalog),
    ).toEqual([
      { resultTypeKey: TYPE, fieldKey: F1, before: null, after: ASSESSED },
      { resultTypeKey: TYPE, fieldKey: F2, before: VIEW, after: HIDDEN },
    ]);
  });
});

describe('diffConfig: first publication (no version) diffs against hidden (DD-2)', () => {
  it('lists only the classified, non-hidden fields, not every applicable one', () => {
    expect(
      diffConfig([at(TYPE, F1, VIEW), at(TYPE, F2, CORE)], null, catalog),
    ).toEqual([
      { resultTypeKey: TYPE, fieldKey: F1, before: null, after: VIEW },
      { resultTypeKey: TYPE, fieldKey: F2, before: null, after: CORE },
    ]);
  });
});

describe('diffConfig: not-in-catalog fields are left out (S-7, DD-12)', () => {
  it('drops a draft field that is no longer in the catalog', () => {
    expect(
      diffConfig(
        [at(TYPE, 'gone.field', ASSESSED), at(TYPE, F1, VIEW)],
        null,
        catalog,
      ),
    ).toEqual([
      { resultTypeKey: TYPE, fieldKey: F1, before: null, after: VIEW },
    ]);
  });

  it('drops a draft field that does not apply to its type, and a draft type that is unknown', () => {
    const notApplicable = RAW.fields.find(
      (f) => !applicableFields(catalog, TYPE).some((a) => a.key === f.key),
    )!.key;
    expect(
      diffConfig(
        [at(TYPE, notApplicable, ASSESSED), at('gone_type', F1, ASSESSED)],
        null,
        catalog,
      ),
    ).toEqual([]);
  });

  it('drops a latest-version row that left the catalog: it is not a change to hidden', () => {
    expect(diffConfig([], [at(TYPE, 'gone.field', ASSESSED)], catalog)).toEqual(
      [],
    );
  });
});
