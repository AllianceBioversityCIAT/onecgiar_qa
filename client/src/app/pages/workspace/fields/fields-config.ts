// Pure helpers for the Fields view: the API's field configuration mapped to what the matrix renders.
import {
  FieldConfigEdit,
  FieldConfigField,
  FieldConfigResultType,
  FieldOptions,
  FieldVisibility,
} from '../../../core/api/field-config.models';
import { FIELD_STATES } from './fields-copy';

export type FieldState = FieldVisibility;

/** How one reporting field behaves in QA for one result type (UI names of the API's `FieldOptions`). */
export interface FieldConfig {
  readonly state: FieldState;
  readonly core: boolean;
  readonly ai: boolean;
}

export interface FieldCounts {
  readonly total: number;
  readonly assessed: number;
  readonly core: number;
  readonly ai: number;
  readonly hidden: number;
  readonly view: number;
}

/** A field never published reads hidden with both flags off (same rule as the server's diff). */
export const UNSET: FieldConfig = { state: 'hidden', core: false, ai: false };

export function fromOptions(o: FieldOptions | null): FieldConfig {
  return o ? { state: o.visibility, core: o.isCore, ai: o.isAiInput } : UNSET;
}

/** Whole option set for a draft edit: flags only travel with `assessed` (S-14, 400 NOT_ASSESSED otherwise). */
export function toEdit(resultTypeKey: string, fieldKey: string, cfg: FieldConfig): FieldConfigEdit {
  const e = effective(cfg);
  return { resultTypeKey, fieldKey, visibility: e.state, isCore: e.core, isAiInput: e.ai };
}

/** Only assessed fields can be core / use AI. */
export function isActive(state: FieldState): boolean {
  return state === 'assessed';
}

/** What actually applies: Core and AI are off unless the field is assessed. */
export function effective(cfg: FieldConfig): FieldConfig {
  const active = isActive(cfg.state);
  return { state: cfg.state, core: active && cfg.core, ai: active && cfg.ai };
}

export function sameConfig(a: FieldConfig, b: FieldConfig): boolean {
  return a.state === b.state && a.core === b.core && a.ai === b.ai;
}

/** Every field of a result type, in catalog order. */
export function fieldsOf(type: FieldConfigResultType): readonly FieldConfigField[] {
  return type.sections.flatMap((s) => s.fields);
}

/** Map key of one field of one result type (overrides and pending edits). */
export function editKey(resultTypeKey: string, fieldKey: string): string {
  return `${resultTypeKey}\u0000${fieldKey}`;
}

export function countFields(configs: readonly FieldConfig[]): FieldCounts {
  const c = { total: 0, assessed: 0, core: 0, ai: 0, hidden: 0, view: 0 };
  for (const cfg of configs) {
    const e = effective(cfg);
    c.total++;
    if (e.state === 'assessed') c.assessed++;
    if (e.state === 'hidden') c.hidden++;
    if (e.state === 'view_only') c.view++;
    if (e.core) c.core++;
    if (e.ai) c.ai++;
  }
  return c;
}

const STATE_LABEL: Readonly<Record<FieldState, string>> = Object.fromEntries(
  FIELD_STATES.map((s) => [s.value, s.label]),
) as Record<FieldState, string>;

export function stateLabel(state: FieldState): string {
  return STATE_LABEL[state];
}

/** "View only, was Assessed" / "Assessed, was Hidden; Core on" / "Core turned on; AI helper turned off". */
export function describeChange(from: FieldConfig, to: FieldConfig): string {
  if (from.state !== to.state) {
    const flags = [to.core && 'Core on', to.ai && 'AI helper on'].filter(Boolean).join(', ');
    return `${STATE_LABEL[to.state]}, was ${STATE_LABEL[from.state]}${flags ? '; ' + flags : ''}`;
  }
  const parts: string[] = [];
  if (from.core !== to.core) parts.push(`Core turned ${to.core ? 'on' : 'off'}`);
  if (from.ai !== to.ai) parts.push(`AI helper turned ${to.ai ? 'on' : 'off'}`);
  return parts.join('; ');
}

/** One row of the matrix, ready to render. */
export interface FieldRowVm {
  readonly id: string;
  readonly name: string;
  /** Field documentation from Reporting; empty when it sends none. */
  readonly doc: string;
  readonly required: boolean;
  /** Not required, but Reporting has a rule that makes it required in some cases. */
  readonly conditional: boolean;
  /** Never classified yet (reads hidden). */
  readonly notSet: boolean;
  /** Draft values as shown (pending edits included). */
  readonly config: FieldConfig;
  /** Draft values that apply. */
  readonly effective: FieldConfig;
  readonly active: boolean;
  /** Differs from the published configuration (3px stripe). */
  readonly changed: boolean;
  readonly dim: boolean;
  /** Required in the reporting tool but hidden / view only in QA. */
  readonly requiredHidden: boolean;
}

export function rowVm(f: FieldConfigField, cfg: FieldConfig, notSet: boolean): FieldRowVm {
  const eff = effective(cfg);
  const required = f.requirement === 'required';
  return {
    id: f.key,
    name: f.label,
    doc: f.description ?? '',
    required,
    conditional: f.requirement === 'conditional',
    notSet,
    config: cfg,
    effective: eff,
    active: isActive(cfg.state),
    changed: !sameConfig(eff, effective(fromOptions(f.published))),
    dim: cfg.state === 'hidden',
    requiredHidden: required && cfg.state !== 'assessed',
  };
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

/** Unpublished changes of one result type (a group in the review pop-up). */
export interface FieldChangeGroupVm {
  readonly typeKey: string;
  readonly type: string;
  readonly changes: readonly FieldChangeVm[];
}
