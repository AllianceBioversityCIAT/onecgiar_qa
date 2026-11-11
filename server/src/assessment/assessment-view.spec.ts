// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import {
  applicableFields,
  shapeCatalog,
  type FieldCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { FieldVisibility } from '../admin-config/field-config/field-config-rules.js';
import {
  buildAssessmentView,
  TOC_SECTION_KEY,
  TOC_SECTION_LABEL,
  type ViewComment,
} from './assessment-view.js';

// The pure view over the real Reporting TEST catalog (2026.30), never a hand
// typed catalog: the order, the Hidden rule, the ToC group, "Other fields" and
// "Not applicable" (FR-8, FR-9, design 7.4, OQ-7 default). Expected values are
// written out as literals from the fixture.

const catalog: FieldCatalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        '../admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const TYPE = 'policy_change';
const applicable = applicableFields(catalog, TYPE).map((f) => f.key);

/** One item per applicable field: `view_only` unless `overrides` says otherwise. */
function config(
  overrides: Record<
    string,
    FieldVisibility | { visibility: FieldVisibility; isCore?: boolean }
  > = {},
  fallback: FieldVisibility = 'view_only',
): ConfigItem[] {
  return applicable.map((fieldKey) => {
    const o = overrides[fieldKey];
    const visibility =
      o === undefined ? fallback : typeof o === 'string' ? o : o.visibility;
    const isCore = typeof o === 'object' && o.isCore === true;
    return {
      resultTypeKey: TYPE,
      fieldKey,
      visibility,
      isCore: visibility === 'assessed' && isCore,
      isAiInput: false,
    };
  });
}

const TOC_KEYS = [
  'toc.planned_result',
  'toc.entries',
  'toc.program_invested_financial_resources',
  'toc.narrative',
  'contributors.science_programs',
];

const ENTRIES = [
  { id: 1, name: 'Contribution one' },
  { id: 2, name: 'Contribution two' },
  { id: 3, name: 'Contribution three' },
];

function build(input: Partial<Parameters<typeof buildAssessmentView>[0]> = {}) {
  return buildAssessmentView({
    catalog,
    resultType: TYPE,
    config: config(),
    values: {},
    labels: undefined,
    validated: new Map(),
    comments: [],
    ...input,
  });
}

const keysOf = (view: ReturnType<typeof build>) =>
  view.sections.flatMap((s) => s.fields.map((f) => f.key));

describe('buildAssessmentView: order (FR-8)', () => {
  it('lists the sections of the 2026 policy_change catalog in ascending order, the Theory of Change just before the section that holds its first field', () => {
    const view = build();
    expect(view.sections.map((s) => s.key)).toEqual([
      'general_information',
      TOC_SECTION_KEY,
      'contributors_partners',
      'geographic_location',
      'policy_change_info',
      'evidence',
    ]);
    expect(view.sections.map((s) => s.label)).toEqual([
      'General information',
      'Theory of Change',
      'Contributors & partners',
      'Geographic location',
      'Policy change',
      'Evidence',
    ]);
  });

  it('keeps the field order of every section, with the ToC fields only in their own section', () => {
    const view = build();
    const byKey = Object.fromEntries(view.sections.map((s) => [s.key, s]));
    expect(byKey['contributors_partners']!.fields.map((f) => f.key)).toEqual([
      'contributors.submitter',
      'contributors.lead_center',
      'contributors.centers',
      'contributors.other_centers',
      'contributors.bilateral_projects',
      'partners.not_applicable',
      'partners.external_partners',
      'partners.is_lead_by_partner',
      'partners.lead_partner',
      'linked.has_innovation_link',
      'linked.results',
    ]);
    expect(byKey[TOC_SECTION_KEY]!.fields.map((f) => f.key)).toEqual(TOC_KEYS);
    expect(byKey['evidence']!.fields.map((f) => f.key)).toEqual([
      'evidence.items',
    ]);
  });

  it('returns exactly the 50 applicable fields of the type when none is Hidden, none of another type', () => {
    const keys = keysOf(build());
    expect(keys).toHaveLength(50);
    expect([...keys].sort()).toEqual([...applicable].sort());
    expect(keys).not.toContain('knowledge_product.type');
  });

  it('carries the catalog label and type, and the section label for the ToC', () => {
    const view = build();
    const title = view.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'general.title')!;
    expect(title).toMatchObject({
      key: 'general.title',
      label: expect.any(String) as string,
      type: 'text',
    });
    expect(TOC_SECTION_LABEL).toBe('Theory of Change');
  });
});

describe('buildAssessmentView: configuration (FR-9)', () => {
  it('drops a Hidden field and an unclassified one, and a section left with no field', () => {
    const view = build({
      config: [
        ...config({ 'general.title': 'hidden', 'evidence.items': 'hidden' }),
      ].filter((i) => i.fieldKey !== 'geo.scope'),
    });
    const keys = keysOf(view);
    expect(keys).not.toContain('general.title');
    expect(keys).not.toContain('evidence.items');
    expect(keys).not.toContain('geo.scope');
    expect(view.sections.map((s) => s.key)).not.toContain('evidence');
    expect(keys).toHaveLength(47);
  });

  it('answers no section at all when everything is Hidden but the ToC group, which is shown whole', () => {
    const view = build({ config: config({}, 'hidden') });
    expect(view.sections.map((s) => s.key)).toEqual([TOC_SECTION_KEY]);
    expect(keysOf(view)).toEqual(TOC_KEYS);
    expect(view.sections[0]!.fields.every((f) => f.mode === 'view')).toBe(true);
  });

  it('shows an Assessed field with its mark, comment action and Core flag, and a View only one with neither', () => {
    const view = build({
      config: config({
        'general.title': { visibility: 'assessed', isCore: true },
        'general.description': 'assessed',
      }),
      validated: new Map([
        ['general.title', true],
        ['general.description', false],
        ['general.lead_contact_person', true],
      ]),
    });
    const f = (key: string) =>
      view.sections.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(f('general.title')).toMatchObject({
      mode: 'assessed',
      core: true,
      validated: true,
    });
    expect(f('general.description')).toMatchObject({
      mode: 'assessed',
      core: false,
      validated: false,
    });
    // A stray validation of a View only field never shows as a mark.
    expect(f('general.lead_contact_person')).toMatchObject({
      mode: 'view',
      core: false,
      validated: false,
      comments: [],
    });
  });

  it('attaches the comments of an Assessed field to it, in the order given, and none to a View only field', () => {
    const comment = (id: number, fieldKey: string): ViewComment => ({
      id,
      fieldKey,
      author: { id: 5, nickname: 'Ana' },
      body: `c${id}`,
      state: 'open',
      stepPosition: 1,
      round: 1,
      valueCopy: { value: 'Old' },
      valueTruncated: false,
      createdAt: '2026-03-15T10:00:00.000Z',
      withdrawnAt: null,
    });
    const view = build({
      config: config({ 'general.title': 'assessed' }),
      comments: [
        comment(1, 'general.title'),
        comment(2, 'general.description'),
        comment(3, 'general.title'),
      ],
    });
    const f = (key: string) =>
      view.sections.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(f('general.title').comments.map((c) => c.id)).toEqual([1, 3]);
    expect(f('general.description').comments).toEqual([]);
  });
});

describe('buildAssessmentView: the Theory of Change (FR-9, OQ-7)', () => {
  it('shows toc.entries read only with all 3 contributions when it is configured Hidden, and keeps another Hidden field out', () => {
    const view = build({
      config: config({ 'toc.entries': 'hidden', 'general.title': 'hidden' }),
      values: { 'toc.entries': ENTRIES, 'general.title': 'A title' },
    });
    const entries = view.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'toc.entries')!;
    expect(entries.mode).toBe('view');
    expect(entries.value).toEqual(ENTRIES);
    expect(entries.validated).toBe(false);
    expect(entries.comments).toEqual([]);
    expect(keysOf(view)).not.toContain('general.title');
    expect(JSON.stringify(view)).not.toContain('A title');
  });

  it('forces every Hidden ToC field to View only, and treats an unclassified one as Hidden', () => {
    const view = build({
      config: config({}, 'hidden').filter(
        (i) => i.fieldKey !== 'toc.narrative',
      ),
      values: { 'toc.narrative': 'Text' },
    });
    const toc = view.sections.find((s) => s.key === TOC_SECTION_KEY)!;
    expect(toc.fields.map((f) => [f.key, f.mode])).toEqual(
      TOC_KEYS.map((k) => [k, 'view']),
    );
    expect(toc.fields.find((f) => f.key === 'toc.narrative')!.value).toBe(
      'Text',
    );
  });

  it('keeps a ToC field configured Assessed as Assessed, with its validation', () => {
    const view = build({
      config: config({
        'toc.narrative': { visibility: 'assessed', isCore: true },
      }),
      validated: new Map([['toc.narrative', true]]),
    });
    const narrative = view.sections
      .find((s) => s.key === TOC_SECTION_KEY)!
      .fields.find((f) => f.key === 'toc.narrative')!;
    expect(narrative).toMatchObject({
      mode: 'assessed',
      core: true,
      validated: true,
    });
  });

  it('gives every element of every contribution back untouched, whatever the size', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: i,
      name: `Contribution ${i}`,
      outputs: [{ id: i, text: 'x'.repeat(500) }],
    }));
    const view = build({
      config: config({ 'toc.entries': 'hidden' }),
      values: { 'toc.entries': many },
    });
    const entries = view.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'toc.entries')!;
    expect(entries.value).toEqual(many);
  });
});

describe('buildAssessmentView: values, labels, other and not applicable (FR-8, FR-11)', () => {
  // Reporting keys the labels by CONTROL LIST (FR-20), never by field key:
  // `general.primary_program` has `control_list: "initiatives"` in the fixture.
  const REPORTING_LABELS = {
    initiatives: { '7': 'SP07', '8': 'SP08' },
    centers: { '1': 'CIAT' },
    toc_levels: { '2': 'Outcome' },
  };

  it('gives a field the labels of its own control list, filtered to that list, and null labels when it names none', () => {
    const view = build({
      values: { 'general.primary_program': 7, 'general.title': 'T' },
      labels: REPORTING_LABELS,
    });
    const f = (key: string) =>
      view.sections.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(f('general.primary_program')).toMatchObject({
      value: 7,
      labels: { initiatives: { '7': 'SP07', '8': 'SP08' } },
      notApplicable: false,
    });
    expect(f('general.title')).toMatchObject({
      value: 'T',
      labels: null,
      notApplicable: false,
    });
  });

  it('does not read a label keyed by the field key: that is not the shape Reporting sends', () => {
    const view = build({
      values: { 'general.primary_program': 7 },
      labels: { 'general.primary_program': { '7': 'SP07' } },
    });
    const field = view.sections
      .flatMap((s) => s.fields)
      .find((x) => x.key === 'general.primary_program')!;
    expect(field.labels).toBeNull();
  });

  it('gives a list field the lists of its subfields too, at any depth, and no list of another field', () => {
    const view = build({
      values: { 'contributors.science_programs': [{ program: 7 }] },
      labels: REPORTING_LABELS,
    });
    const field = view.sections
      .flatMap((s) => s.fields)
      .find((x) => x.key === 'contributors.science_programs')!;
    // `program` names initiatives; the nested `toc_entries.level` names toc_levels; `centers` is nobody's here.
    expect(field.labels).toEqual({
      initiatives: { '7': 'SP07', '8': 'SP08' },
      toc_levels: { '2': 'Outcome' },
    });
  });

  it('carries no labels on a field the snapshot lacks, though its list has some for another field', () => {
    const view = build({
      values: { 'general.title': 'T' },
      labels: REPORTING_LABELS,
    });
    const field = view.sections
      .flatMap((s) => s.fields)
      .find((x) => x.key === 'general.primary_program')!;
    expect(field).toMatchObject({ notApplicable: true, labels: null });
  });

  it('keeps a null label (an id with no row) so the client shows the id', () => {
    const view = build({
      values: { 'general.primary_program': 9 },
      labels: { initiatives: { '9': null } },
    });
    const field = view.sections
      .flatMap((s) => s.fields)
      .find((x) => x.key === 'general.primary_program')!;
    expect(field.labels).toEqual({ initiatives: { '9': null } });
  });

  it('reads Not applicable for a catalog field the snapshot lacks, and a stored null is a value', () => {
    const view = build({ values: { 'general.description': null } });
    const f = (key: string) =>
      view.sections.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(f('general.title')).toMatchObject({
      value: null,
      notApplicable: true,
    });
    expect(f('general.description')).toMatchObject({
      value: null,
      notApplicable: false,
    });
  });

  it('lists a snapshot key missing from the catalog under Other fields, read only, sorted, with no labels (no catalog says which list it names)', () => {
    const view = build({
      values: {
        'zz.legacy': 1,
        'general.title': 'T',
        'aa.retired': { a: 1 },
      },
      labels: REPORTING_LABELS,
    });
    expect(view.other.map((f) => f.key)).toEqual(['aa.retired', 'zz.legacy']);
    expect(view.other[0]).toMatchObject({
      key: 'aa.retired',
      label: 'aa.retired',
      mode: 'view',
      core: false,
      validated: false,
      comments: [],
      value: { a: 1 },
      labels: null,
      notApplicable: false,
    });
    expect(keysOf(view)).not.toContain('zz.legacy');
  });

  it('drops a key under Other fields that the configuration reads Hidden (Reporting removed it mid-cycle), and keeps an unclassified or shown one (FR-9 BUT)', () => {
    const view = build({
      config: [
        ...config(),
        {
          resultTypeKey: TYPE,
          fieldKey: 'removed.hidden',
          visibility: 'hidden',
          isCore: false,
          isAiInput: false,
        },
        {
          resultTypeKey: TYPE,
          fieldKey: 'removed.shown',
          visibility: 'view_only',
          isCore: false,
          isAiInput: false,
        },
        // Another result type's item says nothing about this one.
        {
          resultTypeKey: 'knowledge_product',
          fieldKey: 'removed.other_type',
          visibility: 'hidden',
          isCore: false,
          isAiInput: false,
        },
      ],
      values: {
        'removed.hidden': 'SECRET-HIDDEN-OTHER',
        'removed.shown': 'visible',
        'removed.unclassified': 'kept',
        'removed.other_type': 'kept too',
      },
    });
    expect(view.other.map((f) => f.key)).toEqual([
      'removed.other_type',
      'removed.shown',
      'removed.unclassified',
    ]);
    // The raw body, not the field list: the value is nowhere in it.
    expect(JSON.stringify(view)).not.toContain('SECRET-HIDDEN-OTHER');
    expect(JSON.stringify(view)).not.toContain('removed.hidden');
  });

  it('does not list a catalog key of another result type, nor a Hidden catalog key, under Other fields', () => {
    const view = build({
      config: config({ 'general.title': 'hidden' }),
      values: {
        'knowledge_product.type': 'Journal Article',
        'general.title': 'T',
      },
    });
    expect(view.other).toEqual([]);
  });
});
