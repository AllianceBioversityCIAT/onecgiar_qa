// @akili-spec assessment/step-1-assessment
import {
  applicableFields,
  type CatalogField,
  type FieldCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';

// The assessment view, pure (design 7.4, FR-8, FR-9, OQ-7 default): the
// sections and fields of a result in catalog order, shaped by the effective
// configuration and the snapshot. No store, no HTTP error, no clock. A Hidden
// field is dropped here, so the service never hands a hidden value to the
// controller (FR-9 *BUT*: absent from the response, not hidden by the client).

/** The virtual section of the Theory of Change group (OQ-7). */
export const TOC_SECTION_KEY = 'theory_of_change';
export const TOC_SECTION_LABEL = 'Theory of Change';

/** The ToC group: every `toc.*` field plus `contributors.science_programs` (OQ-7). */
export const isTocField = (key: string): boolean =>
  key.startsWith('toc.') || key === 'contributors.science_programs';

/** How a field is shown: value only, or value with mark and comment action. */
export type FieldMode = 'view' | 'assessed';

/** A comment as the view carries it (the author by nickname only, FR-11). */
export interface ViewComment {
  id: number;
  fieldKey: string;
  author: { id: number; nickname: string | null };
  body: string;
  state: CommentState;
  stepPosition: number;
  round: number;
  /** The field's value, and its labels when present, as the snapshot held it at writing (DD-8). */
  valueCopy: { value: unknown; labels?: unknown };
  valueTruncated: boolean;
  createdAt: string;
  withdrawnAt: string | null;
}

/**
 * `{ control list: { option id: label | null } }`, the shape Reporting sends
 * (FR-20). A field carries only the lists its catalog row names; `null` is an
 * id with no row, shown as the id.
 */
export type ViewLabels = Record<string, Record<string, string | null>>;

/**
 * The snapshot labels of the lists one field names, and only those; `null` when
 * the snapshot has none for it (the ids are shown then). The view and the value
 * copy of a comment (DD-8) share this one rule.
 */
export function labelsForField(
  held: Readonly<ViewLabels> | undefined,
  controlLists: readonly string[],
): ViewLabels | null {
  if (held === undefined) return null;
  const own: ViewLabels = {};
  for (const list of controlLists) {
    if (Object.hasOwn(held, list)) own[list] = held[list]!;
  }
  return Object.keys(own).length === 0 ? null : own;
}

export interface ViewField {
  key: string;
  label: string;
  type: string;
  mode: FieldMode;
  /** `isCore` of an Assessed field; never set on a View only one. */
  core: boolean;
  value: unknown;
  /** The labels of the lists the field names, or null when the snapshot has none for it (ids are shown then). */
  labels: ViewLabels | null;
  /** The green mark. Always false on a View only field. */
  validated: boolean;
  comments: ViewComment[];
  /** The catalog has the field and the snapshot has no key for it (FR-8 "Not applicable"). */
  notApplicable: boolean;
}

export interface ViewSection {
  key: string;
  label: string;
  fields: ViewField[];
}

export interface AssessmentViewInput {
  catalog: FieldCatalog;
  resultType: string;
  /** The effective items of the result type; a field with no item reads Hidden (glossary). */
  config: readonly ConfigItem[];
  values: Readonly<Record<string, unknown>>;
  /** As the snapshot holds them: by control list, for every field of the result. */
  labels: Readonly<ViewLabels> | undefined;
  /** `field key -> validated`. */
  validated: ReadonlyMap<string, boolean>;
  /** In the order they should appear on a field. */
  comments: readonly ViewComment[];
}

export interface AssessmentView {
  sections: ViewSection[];
  /** Snapshot keys missing from the catalog, read only (FR-8). */
  other: ViewField[];
}

/** The mode a configured field is shown in; `null` when it is not returned at all. */
function modeOf(item: ConfigItem | undefined, toc: boolean): FieldMode | null {
  const visibility = item?.visibility ?? 'hidden';
  if (visibility === 'assessed') return 'assessed';
  if (visibility === 'view_only') return 'view';
  // OQ-7: the ToC group is always returned, Hidden shows as View only.
  return toc ? 'view' : null;
}

/**
 * The view of one membership. Sections follow the catalog order and keep the
 * fields that apply to the result type; the ToC group leaves them and forms
 * one virtual section just before the section that holds its first field.
 */
export function buildAssessmentView(
  input: AssessmentViewInput,
): AssessmentView {
  const { catalog, resultType, values } = input;
  const items = new Map(
    input.config
      .filter((item) => item.resultTypeKey === resultType)
      .map((item) => [item.fieldKey, item]),
  );
  const commentsOf = new Map<string, ViewComment[]>();
  for (const comment of input.comments) {
    const list = commentsOf.get(comment.fieldKey) ?? [];
    list.push(comment);
    commentsOf.set(comment.fieldKey, list);
  }

  const labelsOf = (controlLists: readonly string[]): ViewLabels | null =>
    labelsForField(input.labels, controlLists);

  const shape = (
    field: {
      key: string;
      label: string;
      type: string;
      controlLists: readonly string[];
    },
    mode: FieldMode,
    core: boolean,
  ): ViewField => {
    const present = Object.hasOwn(values, field.key);
    const assessed = mode === 'assessed';
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      mode,
      core: assessed && core,
      value: present ? values[field.key] : null,
      // No value, nothing to label: a field the snapshot lacks carries none.
      labels: present ? labelsOf(field.controlLists) : null,
      validated: assessed && input.validated.get(field.key) === true,
      comments: assessed ? [...(commentsOf.get(field.key) ?? [])] : [],
      notApplicable: !present,
    };
  };

  const fieldOf = (field: CatalogField): ViewField | null => {
    const item = items.get(field.key);
    const mode = modeOf(item, isTocField(field.key));
    return mode === null ? null : shape(field, mode, item?.isCore === true);
  };

  const applicable = applicableFields(catalog, resultType);
  const toc = applicable.filter((f) => isTocField(f.key));
  const tocFields = toc.flatMap((f) => fieldOf(f) ?? []);
  const tocOwner = toc[0]?.section;

  const sections: ViewSection[] = [];
  for (const section of catalog.sections) {
    if (section.key === tocOwner && tocFields.length > 0) {
      sections.push({
        key: TOC_SECTION_KEY,
        label: TOC_SECTION_LABEL,
        fields: tocFields,
      });
    }
    const fields = applicable
      .filter((f) => f.section === section.key && !isTocField(f.key))
      .flatMap((f) => fieldOf(f) ?? []);
    if (fields.length > 0) {
      sections.push({ key: section.key, label: section.label, fields });
    }
  }

  // A key the catalog lacks is read only and unclassified unless the pinned
  // configuration names it: one it reads Hidden is dropped like any Hidden
  // field (FR-9 *BUT*), though Reporting no longer lists it. No catalog row, so
  // no control list: it carries no labels.
  const known = new Set(catalog.fields.map((f) => f.key));
  const other = Object.keys(values)
    .filter((key) => !known.has(key) && items.get(key)?.visibility !== 'hidden')
    .sort()
    .map((key) =>
      shape(
        { key, label: key, type: 'unknown', controlLists: [] },
        'view',
        false,
      ),
    );

  return { sections, other };
}
