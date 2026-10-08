// Mock data for the "Fields in QA" view, copied from the QA Platform mockup (MFIELDS, FTYPES, F_*_OV…).
// TODO(api): replace with the field configuration endpoint (per result type: draft + published).

export type FieldState = 'hidden' | 'view' | 'assessed' | 'third';

/** How one reporting field behaves in QA for one result type. */
export interface FieldConfig {
  readonly state: FieldState;
  readonly core: boolean;
  readonly ai: boolean;
}

/** Field id → configuration, for one result type. */
export type FieldConfigMap = Readonly<Record<string, FieldConfig>>;

export interface FieldStateOption {
  readonly value: FieldState;
  readonly label: string;
}

export interface FieldSectionDef {
  readonly id: string;
  readonly name: string;
}

export interface FieldDef {
  readonly id: string;
  readonly section: string;
  readonly name: string;
  /** Required in the reporting tool. */
  readonly required: boolean;
  /** Configuration as Innovation development has it today. */
  readonly init: FieldConfig;
  /** Field documentation shown in the ⓘ tooltip. */
  readonly doc: string;
}

export interface ResultTypeDef {
  readonly name: string;
  /** Assessed fields in the full form (the mockup lists a subset of the 47 fields). */
  readonly assessedCount: number;
}

export interface FieldHeadHelp {
  readonly label: string;
  readonly align: 'start' | 'center';
  readonly text?: string;
  readonly items?: readonly { readonly label: string; readonly text: string }[];
  readonly note?: string;
}

/** Only this type has the "Innovation development" section and its own exceptions. */
export const INNOVATION_DEVELOPMENT = 'Innovation development';

export const FIELD_STATES: readonly FieldStateOption[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'view', label: 'View only' },
  { value: 'assessed', label: 'Assessed' },
  { value: 'third', label: 'Third-party' },
];

export const FIELD_SECTIONS: readonly FieldSectionDef[] = [
  { id: 'general', name: 'General information' },
  { id: 'contrib', name: 'Contributors and partners' },
  { id: 'geo', name: 'Geographic location' },
  { id: 'detail', name: 'Innovation development' },
  { id: 'evidence', name: 'Evidence' },
];

export const RESULT_TYPES: readonly ResultTypeDef[] = [
  { name: 'Knowledge product', assessedCount: 19 },
  { name: 'Innovation development', assessedCount: 17 },
  { name: 'Capacity sharing for development', assessedCount: 21 },
  { name: 'Innovation use', assessedCount: 16 },
  { name: 'Policy change', assessedCount: 15 },
  { name: 'Other output', assessedCount: 11 },
  { name: 'Other outcome', assessedCount: 11 },
];

function field(
  id: string,
  section: string,
  name: string,
  required: boolean,
  state: FieldState,
  core: boolean,
  ai: boolean,
  doc: string,
): FieldDef {
  return { id, section, name, required, init: { state, core, ai }, doc };
}

export const FIELD_DEFS: readonly FieldDef[] = [
  field('level', 'general', 'Result level', true, 'assessed', false, true, 'Whether the result is an output or an outcome. Sets which indicator categories are available.'),
  field('category', 'general', 'Indicator category', true, 'assessed', true, true, 'The result type within the level, for example knowledge product or policy change.'),
  field('title', 'general', 'Title of result', true, 'assessed', true, true, 'A short plain-language name for what was produced or changed. Maximum 30 words.'),
  field('description', 'general', 'Description', true, 'assessed', true, true, 'What the result is, where and when it happened, and who was involved. Maximum 150 words.'),
  field('submitter', 'general', 'Submitter', false, 'view', false, false, 'The person and center that submitted the result. Filled in automatically.'),
  field('hlo', 'general', 'HLO / Outcome', true, 'assessed', true, true, 'The high-level outcome the result contributes to, chosen from the science program workplan.'),
  field('indicator', 'general', 'Indicator', true, 'assessed', true, true, 'The workplan indicator the result is counted against.'),
  field('iagender', 'general', 'Gender equality, youth and social inclusion tag', true, 'assessed', true, true, 'How much the result targets gender equality, youth and social inclusion, on a 0 to 2 scale.'),
  field('iaclimate', 'general', 'Climate adaptation and mitigation tag', true, 'assessed', true, true, 'How much the result targets climate adaptation and mitigation, on a 0 to 2 scale.'),
  field('ianutrition', 'general', 'Nutrition, health and food security tag', true, 'assessed', true, true, 'How much the result targets nutrition, health and food security, on a 0 to 2 scale.'),
  field('iaenv', 'general', 'Environmental health and biodiversity tag', true, 'assessed', true, true, 'How much the result targets environmental health and biodiversity, on a 0 to 2 scale.'),
  field('iapoverty', 'general', 'Poverty reduction, livelihoods and jobs tag', true, 'assessed', true, true, 'How much the result targets poverty reduction, livelihoods and jobs, on a 0 to 2 scale.'),
  field('year', 'general', 'Result year', true, 'hidden', false, false, 'The reporting year. Set by the cycle.'),
  field('centers', 'contrib', 'Contributing CGIAR centers', false, 'hidden', false, false, 'CGIAR centers that contributed staff or funding to the result.'),
  field('sp', 'contrib', 'Contributing science program / Accelerator', false, 'assessed', true, false, 'The science program or accelerator the result is reported under.'),
  field('partners', 'contrib', 'Partners', false, 'assessed', true, true, 'External organizations that took part, selected from the CLARISA institutions list.'),
  field('lead', 'contrib', 'Lead center', false, 'assessed', false, false, 'The single center responsible for the result.'),
  field('prole', 'contrib', 'Partner role', false, 'hidden', false, false, 'The role each partner played, such as co-developer or scaling partner.'),
  field('focus', 'geo', 'Geographic focus', true, 'assessed', false, false, 'Global, regional, national or sub-national scope of the result.'),
  field('regions', 'geo', 'Regions', false, 'view', false, false, 'Regions the result applies to, using UN M49 regions.'),
  field('countries', 'geo', 'Countries', false, 'view', false, false, 'Countries the result applies to.'),
  field('subnat', 'geo', 'Sub-national areas', false, 'hidden', false, false, 'Provinces, states or districts, when the focus is sub-national.'),
  field('typology', 'detail', 'Innovation typology', false, 'hidden', false, false, 'Technological, capacity development, policy or other innovation type.'),
  field('developer', 'detail', 'Innovation developer', false, 'hidden', false, false, 'The team or organization that developed the innovation.'),
  field('readiness', 'detail', 'Innovation readiness', true, 'assessed', true, true, 'Readiness level from 0 to 9 on the innovation readiness scale, with a justification.'),
  field('characterization', 'detail', 'Innovation characterization', false, 'third', false, false, 'Whether the innovation is new, an adaptation, or an improvement of an existing one.'),
  field('users', 'detail', 'Anticipated users', false, 'hidden', false, false, 'The groups expected to use the innovation.'),
  field('userscomment', 'detail', 'Anticipated users comment', false, 'hidden', false, false, 'Free text on the anticipated users.'),
  field('source', 'evidence', 'Source of the evidence', true, 'assessed', true, true, 'The document or dataset that supports the result.'),
  field('link', 'evidence', 'Link', true, 'assessed', false, false, 'A public link to the evidence, preferably in CGSpace.'),
  field('evtype', 'evidence', 'Evidence type', false, 'hidden', false, false, 'Report, dataset, publication, photo or other.'),
  field('docs', 'evidence', 'Supporting documents', false, 'view', false, false, 'Files uploaded alongside the evidence link.'),
];

/** Where the default for all result types differs from Innovation development's current setup. */
export const FIELD_DEFAULT_OVERRIDES: Readonly<Record<string, Partial<FieldConfig>>> = {
  partners: { core: false, ai: false },
  regions: { state: 'hidden' },
  countries: { state: 'hidden' },
};

/** Published configuration of Innovation development = its draft + these (so the draft starts with 3 changes). */
export const FIELD_PUBLISHED_OVERRIDES: Readonly<Record<string, Partial<FieldConfig>>> = {
  partners: { ai: false },
  countries: { state: 'assessed' },
  characterization: { state: 'assessed' },
};

/** Figures of the full 47-field form for Innovation development as it starts (the list above is a subset). */
export const FIELD_SUMMARY_TARGETS = { total: 47, hidden: 26, view: 4, assessedOnly: 16, third: 1, core: 14 } as const;

export const FIELD_HEAD_HELP: readonly FieldHeadHelp[] = [
  {
    label: 'In QA',
    align: 'start',
    items: [
      { label: 'Hidden', text: 'The assessor does not see the field.' },
      { label: 'View only', text: 'The assessor sees it as context. No comments, no AI, not core.' },
      { label: 'Assessed', text: 'The assessor approves it or leaves a comment.' },
      { label: 'Third-party', text: 'The field is referred to an outside reviewer.' },
    ],
    note: 'Assessors can comment on any field that is assessed. They never comment on a view only field.',
  },
  { label: 'Core', align: 'center', text: 'Core fields can be highlighted by the lead assessor and sent to third-party correction.' },
  {
    label: 'AI',
    align: 'center',
    text: 'The AI helper drafts an assessment of this field for the assessor to confirm or override. It never approves a field on its own.',
  },
];

export const REQUIRED_HIDDEN_HELP =
  'This field is required in the reporting tool but hidden in QA, so no assessor will check it.';

export const ACTIVE_STEP_NOTICE =
  'Step 5 is open until 19 Jul 2026. Anything you publish now applies to results loaded from now on.';
