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
  annotateForRound,
  buildAssessmentView,
  TOC_SECTION_KEY,
  TOC_SECTION_LABEL,
  type RoundViewInput,
  type ViewComment,
} from './assessment-view.js';
import type { RoundOneThreadRow } from './assessment.store.js';

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

  it("carries Reporting's help text as description when the catalog row has one, and no description key when it has none", () => {
    const view = build({ values: { 'unknown.key': 'x' } });
    const all = [...view.sections.flatMap((s) => s.fields), ...view.other];
    const f = (key: string) => all.find((x) => x.key === key)!;
    expect(f('general.title').description).toMatch(
      /^Provide a clear, informative name of the output, for a non-specialist reader and/,
    );
    expect(Object.hasOwn(f('general.result_level'), 'description')).toBe(false);
    expect(Object.hasOwn(f('unknown.key'), 'description')).toBe(false);
  });
});

describe('buildAssessmentView: subfield lists', () => {
  it('tells which labels list names each subfield id, and sends no subfieldLists key on a field without one', () => {
    const view = build({
      values: { 'general.title': 'T', 'unknown.key': 'x' },
    });
    const all = [...view.sections.flatMap((s) => s.fields), ...view.other];
    const f = (key: string) => all.find((x) => x.key === key)!;
    expect(f('partners.external_partners').subfieldLists).toEqual({
      institution: 'institutions',
      partner_type: 'institution_types',
      partner_role: 'partner_delivery_types',
    });
    expect(Object.hasOwn(f('general.title'), 'subfieldLists')).toBe(false);
    expect(Object.hasOwn(f('unknown.key'), 'subfieldLists')).toBe(false);
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

// The round layer (escalation/round-2 T-6): FR-3 `actionable`, FR-4 thread, FR-5
// `updated`, FR-7 carried green. Expected values are literals from those
// scenarios. CORE is core; PLAIN is Assessed and not core; the rest View only.
describe('annotateForRound (FR-3, FR-4, FR-5, FR-7)', () => {
  const CORE = 'general.title';
  const CORE_2 = 'general.description';
  const PLAIN = 'general.gender_tag';
  const VIEW_ONLY = 'general.climate_tag';
  const roundView = (validated: Map<string, boolean> = new Map()) =>
    build({
      validated,
      config: config({
        [CORE]: { visibility: 'assessed', isCore: true },
        [CORE_2]: { visibility: 'assessed', isCore: true },
        [PLAIN]: { visibility: 'assessed', isCore: false },
      }),
      values: { [CORE]: 'T', [CORE_2]: 'D', [PLAIN]: 1, [VIEW_ONLY]: 2 },
    });
  const fieldsOf = (view: ReturnType<typeof annotateForRound>) =>
    Object.fromEntries(
      view.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)),
    );

  const line = (over: Partial<RoundOneThreadRow> = {}): RoundOneThreadRow => ({
    commentId: 11,
    fieldKey: CORE,
    authorId: 5,
    authorNickname: 'Ana',
    authorAsAdmin: false,
    body: 'The title is unclear',
    state: 'disagreed',
    valueCopy: { value: 'Old title' },
    valueTruncated: false,
    createdAt: new Date('2026-11-05T09:00:00.000Z'),
    responseId: null,
    responseKind: null,
    responseBody: null,
    responderName: null,
    respondedAt: null,
    answerBody: null,
    answeredAt: null,
    decision: null,
    decisionBody: null,
    decidedAt: null,
    ...over,
  });
  const input = (over: Partial<RoundViewInput> = {}): RoundViewInput => ({
    round: 2,
    role: 'LEAD_ASSESSOR',
    changedFields: null,
    stored: new Map(),
    roundOneGreens: new Set(),
    thread: [],
    userId: 9,
    ownDecisions: new Map(),
    ended: false,
    ...over,
  });

  describe('round 1 is neutral', () => {
    it('marks an Assessed field actionable, nothing updated, no carry, no thread, the stored mark', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(new Map([[PLAIN, true]])),
          input({
            round: 1,
            role: 'ASSESSOR',
            stored: new Map([[PLAIN, true]]),
            roundOneGreens: new Set([CORE]),
            changedFields: [CORE],
            thread: [line()],
          }),
        ),
      );
      expect(
        [CORE, PLAIN, VIEW_ONLY].map((k) => [
          k,
          out[k]!.actionable,
          out[k]!.updated,
          out[k]!.carried,
          out[k]!.thread,
        ]),
      ).toEqual([
        [CORE, true, true, false, []],
        [PLAIN, true, false, false, []],
        [VIEW_ONLY, false, false, false, []],
      ]);
      expect(out[PLAIN]!.effectiveValidated).toBe(true);
      expect(out[CORE]!.effectiveValidated).toBe(false);
    });
  });

  describe('FR-3 actionable in round 2', () => {
    it('only an Assessed core field is actionable', () => {
      const out = fieldsOf(annotateForRound(roundView(), input()));
      expect(
        [CORE, CORE_2, PLAIN, VIEW_ONLY].map((k) => out[k]!.actionable),
      ).toEqual([true, true, false, false]);
    });

    it('a non-core field carries no thread and no carried green even when round 1 had both', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            roundOneGreens: new Set([PLAIN]),
            thread: [line({ fieldKey: PLAIN })],
          }),
        ),
      );
      expect(out[PLAIN]).toMatchObject({
        thread: [],
        carried: false,
        effectiveValidated: false,
      });
    });
  });

  describe('FR-5 updated', () => {
    it('Changed field: changed_fields = [title] marks title and no other field', () => {
      const out = fieldsOf(
        annotateForRound(roundView(), input({ changedFields: [CORE] })),
      );
      expect(
        [CORE, CORE_2, PLAIN, VIEW_ONLY].map((k) => out[k]!.updated),
      ).toEqual([true, false, false, false]);
    });

    it('marks a non-core field that changed too', () => {
      const out = fieldsOf(
        annotateForRound(roundView(), input({ changedFields: [PLAIN] })),
      );
      expect(out[PLAIN]!.updated).toBe(true);
    });

    it('BUT a new round-2 membership (changed_fields NULL) has no updated field', () => {
      const view = annotateForRound(
        roundView(),
        input({ changedFields: null }),
      );
      expect(
        view.sections.flatMap((s) => s.fields).filter((f) => f.updated),
      ).toEqual([]);
    });
  });

  describe('FR-7 carried greens', () => {
    it('Carried green: green in round 1, uncommented, unchanged shows green before any write', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ roundOneGreens: new Set([CORE]) }),
        ),
      );
      expect(out[CORE]).toMatchObject({
        validated: false,
        effectiveValidated: true,
        carried: true,
      });
    });

    it('BUT a field in changed_fields is not carried', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ roundOneGreens: new Set([CORE]), changedFields: [CORE] }),
        ),
      );
      expect(out[CORE]).toMatchObject({
        effectiveValidated: false,
        carried: false,
      });
    });

    it('a round-1 comment on the field blocks the carry', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ roundOneGreens: new Set([CORE]), thread: [line()] }),
        ),
      );
      expect(out[CORE]).toMatchObject({
        effectiveValidated: false,
        carried: false,
      });
    });

    it('the Lead un-greened it: the stored false wins', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            roundOneGreens: new Set([CORE]),
            stored: new Map([[CORE, false]]),
          }),
        ),
      );
      expect(out[CORE]).toMatchObject({
        effectiveValidated: false,
        carried: false,
      });
    });

    it('Accepted and corrected: the Lead greened a changed field', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ changedFields: [CORE], stored: new Map([[CORE, true]]) }),
        ),
      );
      expect(out[CORE]).toMatchObject({
        validated: false,
        effectiveValidated: true,
        carried: false,
      });
    });
  });

  describe('FR-4 the thread', () => {
    // The scenario: the program requested a clarification, the assessor
    // answered, the program then disagreed with a justification.
    const lines = [
      line({
        responseId: 3001,
        responseKind: 'request_clarification',
        responseBody: 'What do you mean?',
        responderName: 'Pat Program',
        respondedAt: new Date('2026-11-12T09:00:00.000Z'),
        answerBody: 'The title repeats the acronym.',
        answeredAt: new Date('2026-11-13T09:00:00.000Z'),
      }),
      line({
        responseId: 3002,
        responseKind: 'disagree',
        responseBody: 'The acronym is the official name.',
        responderName: 'Pat Program',
        respondedAt: new Date('2026-11-14T09:00:00.000Z'),
      }),
    ];

    it('Disagreement with a clarification: shows both values, the request and answer, the latest response; decidable with both choices', () => {
      const out = fieldsOf(
        annotateForRound(roundView(), input({ thread: lines })),
      );
      expect(out[CORE]!.value).toBe('T');
      expect(out[CORE]!.thread).toEqual([
        {
          commentId: 11,
          author: { id: 5, nickname: 'Ana' },
          createdAt: '2026-11-05T09:00:00.000Z',
          body: 'The title is unclear',
          valueCopy: { value: 'Old title' },
          valueTruncated: false,
          state: 'disagreed',
          response: {
            id: 3002,
            kind: 'disagree',
            body: 'The acronym is the official name.',
            respondedBy: { name: 'Pat Program' },
            respondedAt: '2026-11-14T09:00:00.000Z',
          },
          clarifications: [
            {
              requestId: 3001,
              question: 'What do you mean?',
              requestedAt: '2026-11-12T09:00:00.000Z',
              answer: {
                body: 'The title repeats the acronym.',
                answeredAt: '2026-11-13T09:00:00.000Z',
              },
            },
          ],
          decidable: true,
          choices: ['agree_program', 'escalate'],
        },
      ]);
    });

    it('never carries a responder email', () => {
      const withEmail = lines.map((l) => ({
        ...l,
        responderEmail: 'pat@example.org',
      }));
      const view = annotateForRound(roundView(), input({ thread: withEmail }));
      expect(JSON.stringify(view)).not.toContain('pat@example.org');
    });

    it('a comment with no response has no `response` key and an empty clarifications list', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ thread: [line({ state: 'open' })] }),
        ),
      );
      const item = out[CORE]!.thread[0]!;
      expect('response' in item).toBe(false);
      expect(item.clarifications).toEqual([]);
      expect(item.choices).toEqual(['agree_program', 'escalate']);
    });

    it('a clarification not answered yet has a null answer; the Lead decision is shown', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            thread: [
              line({
                state: 'clarification_requested',
                responseId: 3001,
                responseKind: 'request_clarification',
                responseBody: 'Which one?',
                responderName: 'Pat Program',
                respondedAt: new Date('2026-11-12T09:00:00.000Z'),
                decision: 'escalate',
                decisionBody: 'Needs the leads.',
                decidedAt: new Date('2026-11-25T09:00:00.000Z'),
              }),
            ],
          }),
        ),
      );
      const item = out[CORE]!.thread[0]!;
      expect(item.clarifications[0]!.answer).toBeNull();
      expect(item.decision).toEqual({
        decision: 'escalate',
        body: 'Needs the leads.',
        decidedAt: '2026-11-25T09:00:00.000Z',
      });
    });

    it('a closed state (accepted) is listed but not decidable', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({ thread: [line({ state: 'accepted' })] }),
        ),
      );
      expect(out[CORE]!.thread[0]).toMatchObject({
        decidable: false,
        choices: [],
      });
    });

    it('T-17: after the review ended an undecided item is not decidable, no choices; a decided one keeps its decision', () => {
      const ended = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            ended: true,
            thread: [
              line({ commentId: 7001 }),
              line({
                commentId: 7002,
                decision: 'escalate',
                decisionBody: 'Needs the leads.',
                decidedAt: new Date('2026-11-25T09:00:00.000Z'),
              }),
            ],
          }),
        ),
      );
      expect(ended[CORE]!.thread).toMatchObject([
        { commentId: 7001, decidable: false, choices: [] },
        {
          commentId: 7002,
          decision: { decision: 'escalate' },
          decidable: false,
          choices: [],
        },
      ]);
      const before = fieldsOf(
        annotateForRound(
          roundView(),
          input({ ended: false, thread: [line({ commentId: 7001 })] }),
        ),
      );
      expect(before[CORE]!.thread[0]).toMatchObject({
        decidable: true,
        choices: ['agree_program', 'escalate'],
      });
    });

    it('T-17: a field another live comment escalated offers only escalate on the rest; the escalated one keeps both; clearing restores both', () => {
      const thread = (escalated: boolean) => [
        line({
          commentId: 7001,
          ...(escalated
            ? {
                decision: 'escalate' as const,
                decisionBody: 'Needs the leads.',
                decidedAt: new Date('2026-11-25T09:00:00.000Z'),
              }
            : {}),
        }),
        line({ commentId: 7003 }),
        line({ commentId: 7004, state: 'accepted' }),
      ];
      const items = (escalated: boolean) =>
        fieldsOf(
          annotateForRound(roundView(), input({ thread: thread(escalated) })),
        )[CORE]!.thread;
      expect(items(true)).toMatchObject([
        {
          commentId: 7001,
          decidable: true,
          choices: ['agree_program', 'escalate'],
        },
        { commentId: 7003, decidable: true, choices: ['escalate'] },
        { commentId: 7004, decidable: false, choices: [] },
      ]);
      expect(items(false)).toMatchObject([
        { commentId: 7001, choices: ['agree_program', 'escalate'] },
        { commentId: 7003, choices: ['agree_program', 'escalate'] },
        { commentId: 7004, choices: [] },
      ]);
    });

    it('T-17: an escalate on another core field leaves agree_program offered here', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            thread: [
              line({ commentId: 7001, fieldKey: CORE }),
              line({
                commentId: 7002,
                fieldKey: CORE_2,
                decision: 'escalate',
                decisionBody: 'x',
                decidedAt: new Date('2026-11-25T09:00:00.000Z'),
              }),
            ],
          }),
        ),
      );
      expect(out[CORE_2]!.thread[0]).toMatchObject({
        commentId: 7002,
        choices: ['agree_program', 'escalate'],
      });
      expect(out[CORE]!.thread[0]).toMatchObject({
        commentId: 7001,
        decidable: true,
        choices: ['agree_program', 'escalate'],
      });
    });

    it('ADMIN (role null) reads the thread and decides nothing', () => {
      const out = fieldsOf(
        annotateForRound(roundView(), input({ role: null, thread: lines })),
      );
      expect(out[CORE]!.thread[0]).toMatchObject({
        decidable: false,
        choices: [],
      });
    });

    it('groups comments by field in the order given, two comments on one field', () => {
      const out = fieldsOf(
        annotateForRound(
          roundView(),
          input({
            thread: [
              line({ commentId: 11 }),
              line({
                commentId: 12,
                createdAt: new Date('2026-11-06T09:00:00Z'),
              }),
              line({ commentId: 13, fieldKey: CORE_2 }),
            ],
          }),
        ),
      );
      expect(out[CORE]!.thread.map((i) => i.commentId)).toEqual([11, 12]);
      expect(out[CORE_2]!.thread.map((i) => i.commentId)).toEqual([13]);
    });
  });
  // T-16: the Lead's own round-2 comments carry the decision in `comments[]`.
  describe('T-16 the Lead own round-2 comments', () => {
    const own = (over: Partial<ViewComment> = {}): ViewComment => ({
      id: 31,
      fieldKey: CORE,
      author: { id: 9, nickname: 'Lea' },
      body: 'My finding',
      state: 'open',
      stepPosition: 3,
      round: 2,
      valueCopy: { value: 'T' },
      valueTruncated: false,
      createdAt: '2026-11-25T10:00:00.000Z',
      withdrawnAt: null,
      ...over,
    });
    const run = (
      comment: ViewComment,
      over: Partial<RoundViewInput> = {},
    ): Record<string, unknown> => {
      const out = fieldsOf(
        annotateForRound(
          build({
            comments: [comment],
            config: config({
              [CORE]: { visibility: 'assessed', isCore: true },
            }),
            values: { [CORE]: 'T' },
          }),
          input(over),
        ),
      );
      return out[CORE]!.comments[0] as unknown as Record<string, unknown>;
    };
    const decided = new Map([
      [
        31,
        {
          decision: 'escalate',
          body: 'Escalating my own finding',
          decidedAt: '2026-11-25T10:05:00.000Z',
        },
      ],
    ]);

    it('an undecided own comment: decision null, decidable, escalate only', () => {
      expect(run(own())).toMatchObject({
        decision: null,
        decidable: true,
        choices: ['escalate'],
      });
    });

    it('an escalated own comment carries the decision object of thread[]', () => {
      expect(run(own(), { ownDecisions: decided })).toMatchObject({
        decision: {
          decision: 'escalate',
          body: 'Escalating my own finding',
          decidedAt: '2026-11-25T10:05:00.000Z',
        },
        decidable: true,
        choices: ['escalate'],
      });
    });

    it('a withdrawn own comment: not decidable, no choices', () => {
      expect(
        run(
          own({ state: 'withdrawn', withdrawnAt: '2026-11-25T10:06:00.000Z' }),
        ),
      ).toMatchObject({ decidable: false, choices: [] });
    });

    it('after the end the own comment is escalated: not decidable, the decision stays', () => {
      expect(
        run(own({ state: 'escalated' }), { ownDecisions: decided }),
      ).toMatchObject({
        decision: { decision: 'escalate' },
        decidable: false,
        choices: [],
      });
    });

    it('an own comment still open when the review ended: not decidable, no choices, the decision kept', () => {
      expect(run(own(), { ended: true })).toMatchObject({
        decision: null,
        decidable: false,
        choices: [],
      });
      expect(run(own(), { ended: true, ownDecisions: decided })).toMatchObject({
        decision: { decision: 'escalate' },
        decidable: false,
        choices: [],
      });
    });

    it('T-17: the Lead own escalated comment on the field makes a round-1 item offer only escalate', () => {
      const out = fieldsOf(
        annotateForRound(
          build({
            comments: [own()],
            config: config({
              [CORE]: { visibility: 'assessed', isCore: true },
            }),
            values: { [CORE]: 'T' },
          }),
          input({ ownDecisions: decided, thread: [line({ commentId: 7003 })] }),
        ),
      );
      expect(out[CORE]!.thread[0]).toMatchObject({
        decidable: true,
        choices: ['escalate'],
      });
    });

    it('round 1, the Assessor view and another author get no new key', () => {
      const keys = (c: Record<string, unknown>) => Object.keys(c).sort();
      const plain = keys(own() as unknown as Record<string, unknown>);
      expect(keys(run(own(), { round: 1, role: 'ASSESSOR' }))).toEqual(plain);
      expect(keys(run(own(), { role: 'ASSESSOR' }))).toEqual(plain);
      expect(keys(run(own(), { role: null }))).toEqual(plain);
      expect(keys(run(own({ author: { id: 4, nickname: 'Ana' } })))).toEqual(
        plain,
      );
    });
  });
});
