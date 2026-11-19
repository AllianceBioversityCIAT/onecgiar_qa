// @akili-spec assessment/step-1-assessment
import {
  applicableFields,
  type CatalogField,
  type FieldCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';
import type { RoundOneThreadRow } from './assessment.store.js';
import {
  effectiveGreen,
  isActionable,
  isCarriedGreen,
  isDecidable,
  type DecisionChoice,
} from './round-two-rules.js';
import type { ClarificationView, SpResponseView } from './sp-view/sp-thread.js';

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
  /** Reporting's help text for the field tooltip; absent when the catalog row has none. */
  description?: string;
  type: string;
  /**
   * Subfield key -> the control list in `labels` its ids belong to (e.g.
   * `actor_type` -> `actor_types`); absent when no subfield names a list.
   */
  subfieldLists?: Record<string, string>;
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
      description?: string;
      type: string;
      controlLists: readonly string[];
      subfieldLists?: Readonly<Record<string, string>>;
    },
    mode: FieldMode,
    core: boolean,
  ): ViewField => {
    const present = Object.hasOwn(values, field.key);
    const assessed = mode === 'assessed';
    return {
      key: field.key,
      label: field.label,
      ...(field.description ? { description: field.description } : {}),
      type: field.type,
      mode,
      core: assessed && core,
      value: present ? values[field.key] : null,
      // No value, nothing to label: a field the snapshot lacks carries none.
      labels: present ? labelsOf(field.controlLists) : null,
      ...(field.subfieldLists
        ? { subfieldLists: { ...field.subfieldLists } }
        : {}),
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

// ---- The round layer (escalation/round-2 T-6) ---------------------------------
// Added on top of `buildAssessmentView`, never inside it: the Science Program
// view builds from the same function and must not see these members (DD-8).
// Pure: the thread rows, the stored validations and the round-1 facts come in.

/** The Lead's current decision on a round-1 comment (FR-4). */
export interface ThreadDecision {
  decision: string;
  body: string | null;
  decidedAt: string;
}

/**
 * A round-1 comment as the Lead reads it (FR-4, design 6). The author by
 * nickname, the responder by name: never an email (the QA side shows names, the
 * assessor's `sp-responses` route adds the email, this view does not).
 */
export interface ThreadItem {
  commentId: number;
  author: { id: number; nickname: string | null };
  createdAt: string;
  body: string;
  /** The value when the comment was written; the current value is the field's own `value`. */
  valueCopy: { value: unknown; labels?: unknown };
  valueTruncated: boolean;
  state: CommentState;
  /** The program's latest response, when there is one. */
  response?: SpResponseView;
  /** Every clarification request with its answer, oldest first. */
  clarifications: ClarificationView[];
  /** The Lead's decision, when one is set. */
  decision?: ThreadDecision;
  decidable: boolean;
  choices: DecisionChoice[];
}

/** A field with the round members (design 6). Round 1 carries neutral values. */
export interface RoundViewField extends ViewField {
  /** FR-5: the key is in the membership's `changed_fields`. */
  updated: boolean;
  /** FR-3: takes a write. Round 1: Assessed. Round 2: Assessed and core. */
  actionable: boolean;
  /** FR-7, DD-4: the stored validation, else the carried green. Equals `validated` in round 1. */
  effectiveValidated: boolean;
  /** The green is the round-1 one, carried because nothing is stored. */
  carried: boolean;
  /** FR-4: the round-1 thread of an actionable field; empty in round 1. */
  thread: ThreadItem[];
}

export interface RoundViewSection extends Omit<ViewSection, 'fields'> {
  fields: RoundViewField[];
}

export interface RoundView {
  sections: RoundViewSection[];
  other: RoundViewField[];
}

export interface RoundViewInput {
  /** The membership's round: 1 leaves the neutral values. */
  round: number;
  /** The caller's reviewer role at this round; `null` for ADMIN (reads, decides nothing). */
  role: string | null;
  /** `changed_fields` of the membership; `null` = none (a new membership, or round 1). */
  changedFields: readonly string[] | null;
  /** The assessment's own validation rows (`undefined` = no row, which is not `false`). */
  stored: ReadonlyMap<string, boolean>;
  /** Keys green in the previous membership's step-1 assessment. */
  roundOneGreens: ReadonlySet<string>;
  /** The thread read, ordered by field, comment, response (one statement). */
  thread: readonly RoundOneThreadRow[];
}

/** The items of the thread rows, by field key, in row order. The rows hold one line per response worth showing. */
export function toThreadItems(
  rows: readonly RoundOneThreadRow[],
  role: string | null,
  fieldOf: (key: string) => { visibility: string; isCore: boolean },
): Map<string, ThreadItem[]> {
  const byComment = new Map<number, RoundOneThreadRow[]>();
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push(row);
    byComment.set(row.commentId, list);
  }
  const out = new Map<string, ThreadItem[]>();
  for (const lines of byComment.values()) {
    const head = lines[0]!;
    const answered = lines.filter((l) => l.responseId !== null);
    const latest = answered.reduce<RoundOneThreadRow | null>(
      (best, line) =>
        best === null || line.responseId! > best.responseId! ? line : best,
      null,
    );
    const choices = [
      ...isDecidable(
        { origin: 'round_one', state: head.state, deleted: false },
        fieldOf(head.fieldKey),
        role,
      ),
    ];
    const item: ThreadItem = {
      commentId: head.commentId,
      author: { id: head.authorId, nickname: head.authorNickname },
      createdAt: head.createdAt.toISOString(),
      body: head.body,
      valueCopy: head.valueCopy,
      valueTruncated: head.valueTruncated,
      state: head.state,
      ...(latest === null
        ? {}
        : {
            response: {
              id: latest.responseId!,
              kind: latest.responseKind!,
              body: latest.responseBody,
              respondedBy: { name: latest.responderName! },
              respondedAt: latest.respondedAt!.toISOString(),
            },
          }),
      clarifications: answered
        .filter((l) => l.responseKind === 'request_clarification')
        .map((l) => ({
          requestId: l.responseId!,
          question: l.responseBody ?? '',
          requestedAt: l.respondedAt!.toISOString(),
          answer:
            l.answerBody === null
              ? null
              : {
                  body: l.answerBody,
                  answeredAt: l.answeredAt!.toISOString(),
                },
        })),
      ...(head.decision === null
        ? {}
        : {
            decision: {
              decision: head.decision,
              body: head.decisionBody,
              decidedAt: head.decidedAt!.toISOString(),
            },
          }),
      decidable: choices.length > 0,
      choices,
    };
    const list = out.get(head.fieldKey) ?? [];
    list.push(item);
    out.set(head.fieldKey, list);
  }
  return out;
}

/**
 * FR-3, FR-4, FR-5, FR-7 (design 6, 7): the round members of every field. Round
 * 1 is neutral: `updated` false, `actionable` = Assessed, `effectiveValidated` =
 * the stored mark, no carry, no thread. Round 2: the thread and the carried
 * green are for actionable (core) fields; `updated` is for any field.
 */
export function annotateForRound(
  view: AssessmentView,
  input: RoundViewInput,
): RoundView {
  const roundTwo = input.round !== 1;
  const changed = new Set(input.changedFields ?? []);
  const commented = new Set(input.thread.map((row) => row.fieldKey));
  const fieldsByKey = new Map<string, ViewField>();
  for (const section of view.sections) {
    for (const field of section.fields) fieldsByKey.set(field.key, field);
  }
  const configured = (key: string) => {
    const field = fieldsByKey.get(key);
    return {
      visibility: field?.mode === 'assessed' ? 'assessed' : 'view_only',
      isCore: field?.core === true,
    };
  };
  const threads = roundTwo
    ? toThreadItems(input.thread, input.role, configured)
    : new Map<string, ThreadItem[]>();

  const annotate = (field: ViewField): RoundViewField => {
    const assessed = field.mode === 'assessed';
    const actionable = roundTwo
      ? isActionable(configured(field.key))
      : assessed;
    const updated = changed.has(field.key);
    if (!roundTwo || !actionable) {
      return {
        ...field,
        updated,
        actionable,
        effectiveValidated: field.validated,
        carried: false,
        thread: [],
      };
    }
    const facts = {
      green: input.roundOneGreens.has(field.key),
      commented: commented.has(field.key),
      changed: updated,
    };
    const stored = input.stored.get(field.key);
    return {
      ...field,
      updated,
      actionable,
      effectiveValidated: effectiveGreen(stored, facts),
      carried: isCarriedGreen(stored, facts),
      thread: threads.get(field.key) ?? [],
    };
  };

  return {
    sections: view.sections.map((section) => ({
      ...section,
      fields: section.fields.map(annotate),
    })),
    other: view.other.map(annotate),
  };
}
