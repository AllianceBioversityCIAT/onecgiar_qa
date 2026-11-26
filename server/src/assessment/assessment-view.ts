// @akili-spec assessment/step-1-assessment
// @akili-spec admin/acts-as-reviewer
import {
  applicableFields,
  type CatalogField,
  type FieldCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import { isVisible } from '../admin-config/field-config/visible-when.js';
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';
import type {
  EscalationThreadRow,
  RoundOneThreadRow,
} from './assessment.store.js';
import {
  effectiveGreen,
  isActionable,
  isCarriedGreen,
  isDecidable,
  isPpuDecidable,
  isTpbDecidable,
  type DecisionChoice,
  type PpuChoice,
  type TpbChoice,
} from './round-two-rules.js';
import { RoleCode } from '../users/permissions.js';
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

/**
 * Who wrote a comment, as a reviewer or an Admin reads it: the nickname only
 * (FR-11). `admin: true` when a QA Admin wrote it acting as a reviewer role
 * (admin/acts-as-reviewer R4); absent otherwise. The program view never
 * carries an author at all.
 */
export interface ReviewerAuthor {
  id: number;
  nickname: string | null;
  admin?: true;
}

/** The author of a comment or an end, with the Admin mark only when it applies. */
export function reviewerAuthor(
  id: number,
  nickname: string | null,
  asAdmin: boolean,
): ReviewerAuthor {
  return asAdmin ? { id, nickname, admin: true } : { id, nickname };
}

/** A comment as the view carries it (the author by nickname only, FR-11). */
export interface ViewComment {
  id: number;
  fieldKey: string;
  author: ReviewerAuthor;
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
    const toc = isTocField(field.key);
    const mode = modeOf(item, toc);
    if (mode === null) return null;
    const core = item?.isCore === true;
    // F-015: Reporting's `visible_when` on the result's values (an Impact Area
    // component only under a Principal score). Not on the ToC group, always
    // returned (OQ-7), nor on a core field, which Finish needs reachable.
    const conditional = !toc && !(mode === 'assessed' && core);
    if (conditional && !isVisible(field.visibleWhen, resultType, values)) {
      return null;
    }
    return shape(field, mode, core);
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
  author: ReviewerAuthor;
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
  /** The reading role's decision (the Lead's, or the TPB's for a TPB), when one is set. */
  decision?: ThreadDecision;
  decidable: boolean;
  choices: Array<DecisionChoice | TpbChoice | PpuChoice>;
  /** TPB and PPU views (P2-3916 FR-4): 1 for a round-1 comment, 2 for the Lead's own escalated one. */
  round?: number;
  /** TPB and PPU views (P2-3916 FR-4): the Lead's decision and its reason, the context of the escalation. */
  leadDecision?: ThreadDecision;
  /** PPU view only (P2-3917 FR-3): the TPB's decision and its justification. */
  tpbDecision?: ThreadDecision;
}

/** A thread line as `toThreadItems` reads it: the round-1 read, or the TPB's escalation read (DD-T5). */
export type ThreadRow = RoundOneThreadRow &
  Partial<
    Pick<
      EscalationThreadRow,
      | 'round'
      | 'leadDecision'
      | 'leadDecisionBody'
      | 'leadDecidedAt'
      | 'tpbDecision'
      | 'tpbDecisionBody'
      | 'tpbDecidedAt'
    >
  >;

/**
 * The Lead's own round-2 comment as the Lead reads it (T-16): the comment as
 * `comments[]` always carries it, plus the members a `thread[]` item has, so a
 * reload shows whether the Lead already escalated it. `decision` is `null`
 * when none is set. Only the Lead's own round-2 comments take these keys.
 */
export interface OwnViewComment extends ViewComment {
  decision: ThreadDecision | null;
  decidable: boolean;
  choices: DecisionChoice[];
}

/** A field with the round members (design 6). Round 1 carries neutral values. */
export interface RoundViewField extends Omit<ViewField, 'comments'> {
  /** The field's comments; the Lead's own round-2 ones (round 2, Lead) carry `decision`, `decidable` and `choices`. */
  comments: Array<ViewComment | OwnViewComment>;
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
  /** The thread read, ordered by field, comment, response (one statement). The TPB's carries `round` and the Lead's decision (DD-T5). */
  thread: readonly ThreadRow[];
  /**
   * P2-3916: the Lead's (step-3) stored validations, for a TPB. The TPB's
   * effective green is its own mark, else the step-3 effective green (the
   * Lead's mark, else the carried round-1 green). `undefined` for every other reader.
   */
  leadStored?: ReadonlyMap<string, boolean>;
  /** P2-3917: the TPB's (step-4) stored validations, for a PPU: its green sits under the PPU's own mark. */
  tpbStored?: ReadonlyMap<string, boolean>;
  /** The caller's user id: a comment is the Lead's own when it wrote it (T-16). */
  userId: number;
  /** The live decisions of the round-2 assessment by comment id, as `thread[]` shows them (T-16). */
  ownDecisions: ReadonlyMap<number, ThreadDecision>;
  /** The Lead's review has ended: an own comment takes no decision any more, whatever its state (T-16). */
  ended: boolean;
}

/**
 * The items of the thread rows, by field key, in row order. The rows hold one line per response worth showing.
 * `ended` (T-17): the review is over, so no item is decidable and `choices` is empty; `decision` stays.
 * `escalatedOn` (T-17): the ids of the live comments carrying an `escalate` on a field. While ANOTHER
 * comment of the field is escalated, `agree_program` is not offered (the decide route's
 * `ASSESSMENT_FIELD_ESCALATED`); an item's own escalate does not count.
 */
export function toThreadItems(
  rows: readonly ThreadRow[],
  role: string | null,
  fieldOf: (key: string) => { visibility: string; isCore: boolean },
  ended = false,
  escalatedOn: (key: string) => ReadonlySet<number> = () => new Set(),
): Map<string, ThreadItem[]> {
  const byComment = new Map<number, ThreadRow[]>();
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push(row);
    byComment.set(row.commentId, list);
  }
  const out = new Map<string, ThreadItem[]>();
  for (const lines of byComment.values()) {
    const head = lines[0]!;
    const answered = lines.filter((l) => l.responseId !== null);
    const latest = answered.reduce<ThreadRow | null>(
      (best, line) =>
        best === null || line.responseId! > best.responseId! ? line : best,
      null,
    );
    // T-17: once the review ended the decide route refuses every comment, so none reads decidable.
    const blocked = [...escalatedOn(head.fieldKey)].some(
      (id) => id !== head.commentId,
    );
    // P2-3916 (FR-3): a TPB decides the escalated items only; the Lead keeps its rules.
    const choices: Array<DecisionChoice | TpbChoice | PpuChoice> = ended
      ? []
      : role === RoleCode.PPU
        ? [
            ...isPpuDecidable(
              { state: head.state, deleted: false },
              fieldOf(head.fieldKey),
              role,
            ),
          ]
        : role === RoleCode.TPB
        ? [
            ...isTpbDecidable(
              { state: head.state, deleted: false },
              fieldOf(head.fieldKey),
              role,
            ),
          ]
        : [
            ...isDecidable(
              { origin: 'round_one', state: head.state, deleted: false },
              fieldOf(head.fieldKey),
              role,
            ),
          ].filter((choice) => !(blocked && choice === 'agree_program'));
    const item: ThreadItem = {
      commentId: head.commentId,
      author: reviewerAuthor(
        head.authorId,
        head.authorNickname,
        head.authorAsAdmin,
      ),
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
      // TPB read only (DD-T5): the comment's round and the Lead's decision as context.
      ...(head.round === undefined ? {} : { round: head.round }),
      ...(head.leadDecision === undefined || head.leadDecision === null
        ? {}
        : {
            leadDecision: {
              decision: head.leadDecision,
              body: head.leadDecisionBody ?? null,
              decidedAt: head.leadDecidedAt!.toISOString(),
            },
          }),
      // PPU read only (DD-P7): the TPB's decision and its justification.
      ...(role !== RoleCode.PPU ||
      head.tpbDecision === undefined ||
      head.tpbDecision === null
        ? {}
        : {
            tpbDecision: {
              decision: head.tpbDecision,
              body: head.tpbDecisionBody ?? null,
              decidedAt: head.tpbDecidedAt!.toISOString(),
            },
          }),
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
  // The carried-green fact reads round-1 comments only: the TPB's read also holds the Lead's own (round 2).
  const commented = new Set(
    input.thread
      .filter((row) => row.round === undefined || row.round === 1)
      .map((row) => row.fieldKey),
  );
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
  // T-17: per field, the live comments carrying an `escalate`: the round-1 ones of the thread (the read holds live rows only) and the Lead's own round-2 ones.
  const escalators = new Map<string, Set<number>>();
  const addEscalator = (key: string, id: number) =>
    escalators.set(key, (escalators.get(key) ?? new Set<number>()).add(id));
  for (const row of input.thread) {
    if (row.decision === 'escalate') addEscalator(row.fieldKey, row.commentId);
  }
  for (const [key, field] of fieldsByKey) {
    for (const comment of field.comments) {
      if (input.ownDecisions.get(comment.id)?.decision === 'escalate') {
        addEscalator(key, comment.id);
      }
    }
  }
  const threads = roundTwo
    ? toThreadItems(
        input.thread,
        input.role,
        configured,
        input.ended,
        (key) => escalators.get(key) ?? new Set<number>(),
      )
    : new Map<string, ThreadItem[]>();

  // T-16: round 2, Lead only: the Lead's own round-2 comment takes the decision members.
  const withOwn = (field: ViewField): Array<ViewComment | OwnViewComment> =>
    field.comments.map((comment) => {
      if (
        !roundTwo ||
        input.role !== RoleCode.LEAD_ASSESSOR ||
        comment.author.id !== input.userId ||
        comment.round !== input.round
      ) {
        return comment;
      }
      const choices = input.ended
        ? []
        : [
            ...isDecidable(
              {
                origin: 'lead_round_two',
                state: comment.state,
                deleted: false,
              },
              configured(field.key),
              input.role,
            ),
          ];
      return {
        ...comment,
        decision: input.ownDecisions.get(comment.id) ?? null,
        decidable: choices.length > 0,
        choices,
      };
    });

  const annotate = (field: ViewField): RoundViewField => {
    const assessed = field.mode === 'assessed';
    const actionable = roundTwo
      ? isActionable(configured(field.key))
      : assessed;
    const updated = changed.has(field.key);
    if (!roundTwo || !actionable) {
      return {
        ...field,
        comments: withOwn(field),
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
    // P2-3916: for a TPB the step-3 effective green sits under its own mark.
    // P2-3917: for a PPU the step-4 mark sits under its own, then the step-3 one.
    const below =
      input.leadStored === undefined
        ? stored
        : (stored ??
          input.tpbStored?.get(field.key) ??
          input.leadStored.get(field.key));
    return {
      ...field,
      comments: withOwn(field),
      updated,
      actionable,
      effectiveValidated: effectiveGreen(below, facts),
      carried: isCarriedGreen(below, facts),
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
