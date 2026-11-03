import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldIssue } from '../../users/users.errors.js';
import { applicableFields, shapeCatalog } from './field-config-catalog.js';
import {
  validateDraftEdit,
  type DraftEditItem,
  type FieldVisibility,
} from './field-config-rules.js';

// Fixture: the real Reporting TEST catalog 2026.30 (T-2). Which fields apply to
// which type comes from `applicableFields`, never from a hand-built list.
// Expected issues are literals taken from design 6 and FR-4 / FR-5.
const catalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL('./fixtures/reporting-qa-catalog-2026.json', import.meta.url),
      'utf8',
    ),
  ),
);

const TYPE = 'policy_change';
const OTHER_TYPE = 'knowledge_product';
const applicable = applicableFields(catalog, TYPE);
const FIELD = applicable[0]!.key;
const OTHER_FIELD = applicable[1]!.key;
// A real catalog field that does not apply to TYPE.
const NOT_APPLICABLE = catalog.fields.find(
  (f) => !f.resultTypes.includes(TYPE),
)!.key;

const item = (over: Partial<DraftEditItem> = {}): DraftEditItem => ({
  resultTypeKey: TYPE,
  fieldKey: FIELD,
  visibility: 'assessed',
  ...over,
});

describe('fixture sanity', () => {
  it('has a field that applies to the type and one that does not', () => {
    expect(applicable.map((f) => f.key)).toContain(FIELD);
    expect(applicable.map((f) => f.key)).not.toContain(NOT_APPLICABLE);
    expect(applicableFields(catalog, OTHER_TYPE).map((f) => f.key)).toContain(
      FIELD,
    );
  });
});

describe('validateDraftEdit: the flags rule (FR-4), table over visibility x flags x sent/omitted', () => {
  const visibilities: FieldVisibility[] = ['hidden', 'view_only', 'assessed'];
  // `undefined` = omitted from the request.
  const flagValues: Array<boolean | undefined> = [undefined, false, true];

  const cases = visibilities.flatMap((visibility) =>
    flagValues.flatMap((isCore) =>
      flagValues.map((isAiInput) => {
        const issues: FieldIssue[] = [];
        if (visibility !== 'assessed') {
          if (isCore === true)
            issues.push({ field: 'items[0].isCore', code: 'NOT_ASSESSED' });
          if (isAiInput === true)
            issues.push({ field: 'items[0].isAiInput', code: 'NOT_ASSESSED' });
        }
        return { visibility, isCore, isAiInput, issues };
      }),
    ),
  );

  it.each(cases)(
    'visibility=$visibility isCore=$isCore isAiInput=$isAiInput',
    ({ visibility, isCore, isAiInput, issues }) => {
      const sent: DraftEditItem = item({ visibility });
      if (isCore !== undefined) sent.isCore = isCore;
      if (isAiInput !== undefined) sent.isAiInput = isAiInput;
      expect(validateDraftEdit(catalog, [sent])).toEqual(issues);
    },
  );

  it('explicit contradiction: view_only with isCore true names that item isCore (FR-4)', () => {
    expect(
      validateDraftEdit(catalog, [
        item({ visibility: 'view_only', isCore: true }),
      ]),
    ).toEqual([{ field: 'items[0].isCore', code: 'NOT_ASSESSED' }]);
  });

  it('switching off: hidden with both flags omitted is valid (FR-4)', () => {
    expect(
      validateDraftEdit(catalog, [item({ visibility: 'hidden' })]),
    ).toEqual([]);
  });
});

describe('validateDraftEdit: references (FR-5, DD-11)', () => {
  it('an unknown type is INVALID at items[i].resultTypeKey', () => {
    expect(
      validateDraftEdit(catalog, [item(), item({ resultTypeKey: 'nope' })]),
    ).toEqual([{ field: 'items[1].resultTypeKey', code: 'INVALID' }]);
  });

  it('a field not applicable to its type is INVALID at items[i].fieldKey', () => {
    expect(
      validateDraftEdit(catalog, [item({ fieldKey: NOT_APPLICABLE })]),
    ).toEqual([{ field: 'items[0].fieldKey', code: 'INVALID' }]);
  });

  it('a field key that is not in the catalog at all is INVALID at items[i].fieldKey', () => {
    expect(
      validateDraftEdit(catalog, [item({ fieldKey: 'no.such_field' })]),
    ).toEqual([{ field: 'items[0].fieldKey', code: 'INVALID' }]);
  });

  it('a repeated (type, field) is INVALID at the later item, not the first', () => {
    expect(validateDraftEdit(catalog, [item(), item(), item()])).toEqual([
      { field: 'items[1].fieldKey', code: 'INVALID' },
      { field: 'items[2].fieldKey', code: 'INVALID' },
    ]);
  });

  it('the same field under two different types is not a repeat', () => {
    expect(
      validateDraftEdit(catalog, [item(), item({ resultTypeKey: OTHER_TYPE })]),
    ).toEqual([]);
  });

  it('a valid batch of three items has no issue', () => {
    expect(
      validateDraftEdit(catalog, [
        item({ visibility: 'hidden' }),
        item({ fieldKey: OTHER_FIELD, visibility: 'view_only' }),
        item({ resultTypeKey: OTHER_TYPE, isCore: true, isAiInput: true }),
      ]),
    ).toEqual([]);
  });
});

describe('validateDraftEdit: several problems at once (FR-5), in item order', () => {
  it('lists an unknown type, a non-applicable field and a core flag on a hidden field, without stopping at the first', () => {
    expect(
      validateDraftEdit(catalog, [
        item({ resultTypeKey: 'nope' }),
        item({ fieldKey: NOT_APPLICABLE }),
        item({ fieldKey: OTHER_FIELD, visibility: 'hidden', isCore: true }),
      ]),
    ).toEqual([
      { field: 'items[0].resultTypeKey', code: 'INVALID' },
      { field: 'items[1].fieldKey', code: 'INVALID' },
      { field: 'items[2].isCore', code: 'NOT_ASSESSED' },
    ]);
  });

  it('inside one item the order is fieldKey, isCore, isAiInput', () => {
    expect(
      validateDraftEdit(catalog, [
        item({
          fieldKey: 'no.such_field',
          visibility: 'hidden',
          isCore: true,
          isAiInput: true,
        }),
      ]),
    ).toEqual([
      { field: 'items[0].fieldKey', code: 'INVALID' },
      { field: 'items[0].isCore', code: 'NOT_ASSESSED' },
      { field: 'items[0].isAiInput', code: 'NOT_ASSESSED' },
    ]);
  });

  it('an unknown type is one problem: its field cannot be judged, the flags still are', () => {
    expect(
      validateDraftEdit(catalog, [
        item({
          resultTypeKey: 'nope',
          visibility: 'hidden',
          isCore: true,
        }),
      ]),
    ).toEqual([
      { field: 'items[0].resultTypeKey', code: 'INVALID' },
      { field: 'items[0].isCore', code: 'NOT_ASSESSED' },
    ]);
  });

  it('keeps item order across a repeat and a later contradiction', () => {
    expect(
      validateDraftEdit(catalog, [
        item(),
        item({ visibility: 'view_only', isAiInput: true }),
        item({ fieldKey: OTHER_FIELD, visibility: 'hidden', isCore: true }),
      ]),
    ).toEqual([
      { field: 'items[1].fieldKey', code: 'INVALID' },
      { field: 'items[1].isAiInput', code: 'NOT_ASSESSED' },
      { field: 'items[2].isCore', code: 'NOT_ASSESSED' },
    ]);
  });
});
