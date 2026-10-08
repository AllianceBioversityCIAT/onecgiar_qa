// Pure helpers for the Fields view (ports of the mockup's fieldsFor / fDefault / fEff / fCounts / fDescribe).
import {
  FIELD_DEFAULT_OVERRIDES,
  FIELD_DEFS,
  FIELD_PUBLISHED_OVERRIDES,
  FIELD_SECTIONS,
  FIELD_STATES,
  FIELD_SUMMARY_TARGETS,
  FieldConfig,
  FieldConfigMap,
  FieldDef,
  FieldState,
  INNOVATION_DEVELOPMENT,
  RESULT_TYPES,
} from './fields.mock';

export interface FieldCounts {
  readonly total: number;
  readonly assessed: number;
  readonly assessedOnly: number;
  readonly core: number;
  readonly ai: number;
  readonly hidden: number;
  readonly view: number;
  readonly third: number;
}

/** The "Innovation development" section only exists for that result type. */
export function fieldsFor(type: string): readonly FieldDef[] {
  return FIELD_DEFS.filter((f) => f.section !== 'detail' || type === INNOVATION_DEVELOPMENT);
}

/** Default configuration shared by all result types. */
export function defaultOf(f: FieldDef): FieldConfig {
  return { ...f.init, ...FIELD_DEFAULT_OVERRIDES[f.id] };
}

/** Draft as it starts for a type (Innovation development keeps its exceptions). */
export function initialDraft(type: string): FieldConfigMap {
  return Object.fromEntries(
    fieldsFor(type).map((f) => [f.id, type === INNOVATION_DEVELOPMENT ? { ...f.init } : defaultOf(f)]),
  );
}

/** Published configuration as it starts (Innovation development has 3 unpublished changes). */
export function initialPublished(type: string): FieldConfigMap {
  const draft = initialDraft(type);
  if (type !== INNOVATION_DEVELOPMENT) return draft;
  return Object.fromEntries(
    Object.entries(draft).map(([id, cfg]) => [id, { ...cfg, ...FIELD_PUBLISHED_OVERRIDES[id] }]),
  );
}

/** Assessed and Third-party fields can be core / use AI. */
export function isActive(state: FieldState): boolean {
  return state === 'assessed' || state === 'third';
}

/** What actually applies: Core and AI are off unless the field is assessed. */
export function effective(cfg: FieldConfig): FieldConfig {
  const active = isActive(cfg.state);
  return { state: cfg.state, core: active && cfg.core, ai: active && cfg.ai };
}

export function sameConfig(a: FieldConfig, b: FieldConfig): boolean {
  return a.state === b.state && a.core === b.core && a.ai === b.ai;
}

export function countFields(type: string, cfg: FieldConfigMap): FieldCounts {
  const c = { total: 0, assessed: 0, assessedOnly: 0, core: 0, ai: 0, hidden: 0, view: 0, third: 0 };
  for (const f of fieldsFor(type)) {
    const e = effective(cfg[f.id]);
    c.total++;
    if (isActive(e.state)) c.assessed++;
    if (e.state === 'assessed') c.assessedOnly++;
    if (e.state === 'hidden') c.hidden++;
    if (e.state === 'view') c.view++;
    if (e.state === 'third') c.third++;
    if (e.core) c.core++;
    if (e.ai) c.ai++;
  }
  return c;
}

const INITIAL_ID_COUNTS = countFields(INNOVATION_DEVELOPMENT, initialDraft(INNOVATION_DEVELOPMENT));

/** The mock lists a subset of the form; these offsets bring the figures up to the full 47-field form. */
export const SUMMARY_OFFSETS = {
  total: FIELD_SUMMARY_TARGETS.total - INITIAL_ID_COUNTS.total,
  hidden: FIELD_SUMMARY_TARGETS.hidden - INITIAL_ID_COUNTS.hidden,
  view: FIELD_SUMMARY_TARGETS.view - INITIAL_ID_COUNTS.view,
  assessedOnly: FIELD_SUMMARY_TARGETS.assessedOnly - INITIAL_ID_COUNTS.assessedOnly,
  third: FIELD_SUMMARY_TARGETS.third - INITIAL_ID_COUNTS.third,
  core: FIELD_SUMMARY_TARGETS.core - INITIAL_ID_COUNTS.core,
} as const;

/** Per type: assessed fields of the full form that are not in the mock list. */
export const ASSESSED_OFFSETS: Readonly<Record<string, number>> = Object.fromEntries(
  RESULT_TYPES.map((t) => [t.name, t.assessedCount - countFields(t.name, initialDraft(t.name)).assessed]),
);

const STATE_LABEL: Readonly<Record<FieldState, string>> = Object.fromEntries(
  FIELD_STATES.map((s) => [s.value, s.label]),
) as Record<FieldState, string>;

export function stateLabel(state: FieldState): string {
  return STATE_LABEL[state];
}

/** "View only, was Assessed" / "Core turned on; AI helper turned off". */
export function describeChange(from: FieldConfig, to: FieldConfig): string {
  if (from.state !== to.state) return `${STATE_LABEL[to.state]}, was ${STATE_LABEL[from.state]}`;
  const parts: string[] = [];
  if (from.core !== to.core) parts.push(`Core turned ${to.core ? 'on' : 'off'}`);
  if (from.ai !== to.ai) parts.push(`AI helper turned ${to.ai ? 'on' : 'off'}`);
  return parts.join('; ');
}

export function sectionName(id: string): string {
  return FIELD_SECTIONS.find((s) => s.id === id)?.name ?? id;
}

/** CSV with the effective configuration of one result type (same columns as the mockup). */
export function configurationCsv(type: string, cfg: FieldConfigMap): string {
  const rows: string[][] = [['Section', 'Field', 'Required', 'In QA', 'Core', 'AI']];
  for (const f of fieldsFor(type)) {
    const e = effective(cfg[f.id]);
    rows.push([sectionName(f.section), f.name, f.required ? 'Yes' : 'No', STATE_LABEL[e.state], e.core ? 'On' : 'Off', e.ai ? 'On' : 'Off']);
  }
  return rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
}

/** One row of the matrix, ready to render. */
export interface FieldRowVm {
  readonly id: string;
  readonly name: string;
  readonly doc: string;
  readonly required: boolean;
  /** Draft values as stored (Core/AI keep their value while the field is not assessed). */
  readonly config: FieldConfig;
  /** Draft values that apply. */
  readonly effective: FieldConfig;
  readonly active: boolean;
  /** Differs from the published configuration (3px stripe). */
  readonly changed: boolean;
  readonly dim: boolean;
  readonly isDefault: boolean;
  readonly isException: boolean;
  /** Required in the reporting tool but hidden / view only in QA. */
  readonly requiredHidden: boolean;
}

export interface FieldSectionVm {
  readonly id: string;
  readonly name: string;
  readonly open: boolean;
  readonly total: number;
  readonly assessed: number;
  readonly rows: readonly FieldRowVm[];
}

export interface FieldChangeVm {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}
