// @akili-spec assessment/step-1-assessment
import {
  AssessmentComment,
  AssessmentField,
  AssessmentView,
  CommentClarification,
  CommentThread,
  FieldLabels,
  AssessmentReadOnlyReason,
  CommentState,
  LeadDecisionKind,
  ProgramResponseKind,
  TOC_SECTION_KEY,
  ThreadItem,
} from '../../../core/api/assessment.models';
import { reviewerLabel } from '../../../core/api/acting-role';
import { evidenceEntry } from '../../../core/domain/evidence-entry';
import { fieldLabel } from '../../../core/domain/field-label';
import { formatDay, romeInstantLabel, todayInRome } from '../../../core/domain/rome-date';
import { STATUS_LABELS, qaStatusPill } from '../results/qa-status';
import type { CommentsDrawerMode, CommentsDrawerVm } from './review-comments-drawer';
import {
  CardStatusVm,
  FieldActions,
  FieldVm,
  ResultHeaderVm,
  StateChip,
  TocCardVm,
  TocGroupVm,
  ThreadItemVm,
  TocLinkVm,
} from './review-model';
import type { FieldComment } from './review.mock';

/*
 * API assessment view → the Review page's existing view models (design § 8). Pure: no injection, no clock.
 * AI is not connected in this step: every card gets `ai: null` (`cardStatus`, the single place a card's
 * extras are set). P2-3918 adds its AI entry there.
 */

/** "Other fields": snapshot keys the catalog does not have, read only (FR-8). */
export const OTHER_SECTION_KEY = 'other';

/** One comment of a thread, by nickname only (FR-11). */
export interface ReviewCommentVm extends FieldComment {
  readonly id: number;
  readonly authorId: number;
  readonly open: boolean;
  readonly canWithdraw: boolean;
  readonly canDelete: boolean;
}

/** Who reads the thread: the caller's user id, and whether their step still lets them take a comment back. */
export interface ThreadReader {
  readonly me: number | null;
  readonly canWithdraw: boolean;
  /** False once the server said the programs step is closed: the clarification form is not offered (P2-3911). */
  readonly canClarify?: boolean;
  /** Round 2 (Lead): another reviewer's open comment may be deleted (`deleteOpen`). */
  readonly canDelete?: boolean;
}

const NO_READER: ThreadReader = { me: null, canWithdraw: false };

/**
 * A comment can be taken back while the caller writes on the assessment, and also after it ended (the server allows
 * it while step 1 or 2 is open, FR-13). Any other read-only reason (admin, step closed, no step) offers nothing.
 */
export function withdrawOpen(view: Pick<AssessmentView, 'writable' | 'readOnlyReason'> & Pick<Partial<AssessmentView>, 'round'>): boolean {
  // Round 2: after the Lead's end the server refuses it (an escalated comment is no longer open; contract § 4.5).
  return view.writable || (view.readOnlyReason === 'finished' && view.round !== 2);
}

/**
 * Round 2 (Lead): another reviewer's comment can be deleted while the Lead writes on the review (contract § 4.4). The
 * server also refuses the Lead's own comment and one the program answered; the comment-level rule is the mapper's.
 */
export function deleteOpen(view: Pick<AssessmentView, 'writable'> & Pick<Partial<AssessmentView>, 'round'>): boolean {
  return view.round === 2 && view.writable;
}

export interface TocVm {
  readonly groups: readonly TocGroupVm[];
  /** Contribution cards. */
  readonly count: number;
  readonly programs: number;
  /** Assessed ToC fields that are green. */
  readonly reviewed: number;
  /** ToC fields the configuration marks as Assessed (0 = the whole section is shown for context only). */
  readonly assessed: number;
}

export interface ReviewSectionVm {
  readonly key: string;
  readonly name: string;
  readonly isToc: boolean;
  /** Field cards (empty for the ToC section, which uses `toc`). */
  readonly fields: readonly FieldVm[];
  readonly toc: TocVm | null;
  /** Assessed fields of the section still neither green nor commented. */
  readonly open: number;
}

export interface ReviewVm {
  readonly header: ResultHeaderVm;
  readonly sections: readonly ReviewSectionVm[];
  readonly writable: boolean;
  /** Why the page is read only, for the banner (FR-23); `null` when the caller can write. */
  readonly banner: string | null;
  /** Assessed fields that are green or commented / all Assessed fields. */
  readonly resolved: number;
  readonly total: number;
  /** Assessed fields with at least one open comment. */
  readonly commented: number;
  /** Assessed fields that are green. */
  readonly validated: number;
  /** Finish is offered: writable and the assessment still pending (FR-15). */
  readonly canFinish: boolean;
  /**
   * Status the result takes if it is finished now, mirroring the server's `endOnFinish`: empty while Finish would
   * be refused (`finishBlockedBy`); returned while a core field is grey (and commented), and in step 1 also while
   * any comment still stands (`returnsOnAnyComment`); Quality Assessed otherwise. Round 2 (Lead): Pending for
   * TPB review while a core field is effectively grey, Quality Assessed otherwise (`finishOutcome`).
   */
  readonly finishTo: string;
  /**
   * P2-4138: labels of the core fields that are grey with no comment that still stands, in page order. The server
   * refuses Finish while any is left (409 `ASSESSMENT_CORE_UNCOMMENTED`), so the page names them instead of an outcome.
   */
  readonly finishBlockedBy: readonly string[];
  /** The same fields as `finishBlockedBy`, with their keys (the footer links to each). */
  readonly finishBlockedFields: readonly { readonly key: string; readonly label: string }[];
}

const ASSESSOR_INSTRUCTIONS =
  'Review each field against the assessor guidance. Mark it as validated, or leave a comment explaining what needs to change.';
const READ_ONLY_INSTRUCTIONS =
  'This assessment is read only for you. You can read every field and its comments.';
/** The caller may write, but the page offers no write (`writes` off in `toReviewVm`). */
const READING_INSTRUCTIONS =
  'Read each field against the assessor guidance. You can open the comments of a field.';

/** An auto-validated result is not assessed: Reporting released it as QAed at the load. */
const AUTO_VALIDATED_BANNER = 'Auto-validated: this result is not assessed.';
const AUTO_VALIDATED_INSTRUCTIONS =
  'This result was auto-validated, so there is nothing to assess. You can read every field.';

/** Subfield keys of the ToC lists and their catalog labels (`reporting-qa-catalog-2026.json`). */
const SUBFIELD_LABELS: Readonly<Record<string, string>> = {
  level: 'Level',
  toc_result: 'Output/Outcome',
  hlo_statement: 'High Level Output Statement',
  kpi: 'KPI statement',
  indicator_typology: 'Indicator typology',
  unit_of_measurement: 'Unit of measurement',
  target: 'Target',
  contribution_to_target: 'Contribution to indicator target',
  program: 'Science Program',
  from_toc: 'Identified in the ToC',
  planned_result: 'Can this result be mapped to a ToC KPI?',
  toc_entries: 'ToC contributions',
};

/** Subfields whose value is an option id of a control list (labelled when the snapshot has the labels). */
const SUBFIELD_LISTS: Readonly<Record<string, string>> = {
  level: 'toc_levels',
  toc_result: 'toc_results',
  kpi: 'toc_results_indicators',
  program: 'initiatives',
};

type Json = unknown;

/** "12 Nov 2026" of an instant, as the calendar day in Rome (the QA clock), never the UTC day. */
const romeDay = (iso: string): string => {
  const at = new Date(iso);
  return isNaN(at.getTime()) ? formatDay(iso.slice(0, 10)) : formatDay(todayInRome(at));
};

/**
 * "12 Nov 2026, 11:15 CET" of an instant: the Rome day and time, the label the page already uses for instants
 * (`romeInstantLabel`). The day alone when the text is not an instant with its offset.
 */
const romeStamp = (iso: string): string => romeInstantLabel(iso) ?? romeDay(iso);

const isObject = (v: Json): v is Readonly<Record<string, Json>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (v: Json): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
/**
 * A list entry with nothing in it. Reporting keeps one entry with every subfield null when the result is not mapped
 * to the ToC (seen on TEST, 17-nov): it is no contribution, and it must not paint an empty card.
 */
const isBlankEntry = (v: Json): boolean =>
  isObject(v) &&
  Object.values(v).every((x) => isEmpty(x) || (Array.isArray(x) && x.every(isBlankEntry)));
const humanize = (key: string): string =>
  SUBFIELD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ');

/** The label of an option id: from one list, or from any list the field carries; the id when there is none. */
function labelOf(id: Json, labels: FieldLabels | null, list?: string): string {
  const key = String(id);
  const lists = labels ? (list ? [labels[list]] : Object.values(labels)) : [];
  for (const options of lists) {
    const label = options?.[key];
    if (typeof label === 'string') return label;
  }
  return key;
}

function scalarText(
  v: Json,
  labels: FieldLabels | null,
  list: string | undefined,
  select: boolean,
): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (isEmpty(v)) return '—';
  if (select && (typeof v === 'number' || typeof v === 'string')) return labelOf(v, labels, list);
  if (typeof v === 'string') return romeInstantLabel(v) ?? v;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * Subfields that repeat `value` for the directory (Lead contact person: `{ value, directory_user }`, both the same
 * name, seen in the 23-nov demo as "Value: … · Directory user: …"). An entry made of `value` and these reads as its value.
 */
const ECHOES_VALUE = new Set(['directory_user']);
const valueOnly = (entry: Readonly<Record<string, Json>>): Json | undefined =>
  Object.hasOwn(entry, 'value') && !isEmpty(entry['value']) && Object.keys(entry).every((k) => k === 'value' || ECHOES_VALUE.has(k) || isEmpty(entry[k]))
    ? entry['value']
    : undefined;

/**
 * One entry of a list field: "Level: Outcome · Target: 4". A subfield is labelled when `lists` names its control
 * list: the ToC ones always, the others from the field's `subfieldLists` (e.g. "Actor type: Farmers", not "1").
 */
function entryText(
  raw: Json,
  labels: FieldLabels | null,
  lists: Readonly<Record<string, string>> = SUBFIELD_LISTS,
): string {
  if (!isObject(raw)) return scalarText(raw, labels, undefined, !!labels);
  const entry = evidenceEntry(raw);
  const single = valueOnly(entry);
  if (single !== undefined) return scalarText(single, labels, lists['value'], Object.hasOwn(lists, 'value'));
  return Object.entries(entry)
    .filter(([, v]) => !isEmpty(v))
    .map(
      ([k, v]) =>
        `${humanize(k)}: ${Array.isArray(v) ? v.map((x) => entryText(x, labels, lists)).join('; ') : scalarText(v, labels, lists[k], Object.hasOwn(lists, k))}`,
    )
    .join(' · ');
}

/** The text of a field value, with labels when the snapshot has them and the ids otherwise (FR-8, FR-20). */
export function formatValue(
  field: Pick<AssessmentField, 'value' | 'labels' | 'notApplicable' | 'subfieldLists'>,
): string {
  if (field.notApplicable) return 'Not applicable';
  const { value, labels } = field;
  const lists = field.subfieldLists
    ? { ...SUBFIELD_LISTS, ...field.subfieldLists }
    : SUBFIELD_LISTS;
  if (isEmpty(value)) return '—';
  if (Array.isArray(value)) {
    const items = value.filter((v) => !isBlankEntry(v));
    if (!items.length) return '—';
    return items.every((v) => !isObject(v))
      ? items.map((v) => scalarText(v, labels, undefined, !!labels)).join(', ')
      : items.map((v) => entryText(v, labels, lists)).join('\n');
  }
  if (isObject(value)) return entryText(value, labels, lists);
  return scalarText(value, labels, undefined, !!labels);
}

const isAutoValidated = (view: Pick<AssessmentView, 'header'>): boolean =>
  view.header.status === 'auto_validated';
/**
 * A field of a result nobody assesses, as context: its value, with no mark, no Core tag, no count and no button.
 * The API still sends it as Assessed and grey (seen on TEST, 17-nov: 9039 and 9816 read "7 pending").
 */
const asContext = (f: AssessmentField): AssessmentField => ({ ...f, mode: 'view', validated: false });

/**
 * Round 2 (Lead): only an `actionable` field (an Assessed core field) takes a check, a comment or a decision; any
 * other field is context, drawn like a field the configuration does not assess (round-2 contract § 1, § 3).
 * Round 1, or `actionable` absent: the field as sent. `thread`, `decidable` and `choices` are not read here.
 */
const leadContext = (f: AssessmentField): AssessmentField =>
  f.actionable === false ? { ...f, mode: 'view' } : f;

const openComments = (f: AssessmentField): readonly AssessmentComment[] =>
  f.comments.filter((c) => c.state !== 'withdrawn');
/**
 * Step 1 with a comment that still stands, on any field (core or not, "Other fields" too): the result never
 * ends by itself and Finish returns it to the program (FR-14, FR-15; OQ-2, 2026-11-18). The server decides
 * (`endAfterValidation` / `endOnFinish` with `hasCommentsInRoundOne`); this is what the page announces before.
 */
export function returnsOnAnyComment(view: AssessmentView): boolean {
  if (view.header.step?.position !== 1) return false;
  return [...view.sections.flatMap((s) => s.fields), ...view.other].some((f) => openComments(f).length > 0);
}
const isAssessed = (f: AssessmentField): boolean => f.mode === 'assessed';
/**
 * The green mark of a field (round-2 contract § 3): the stored mark, else the green carried from round 1. A round-1
 * view sends `effectiveValidated` equal to `validated`, or not at all (step-1 server): then the stored mark.
 * `validated` itself stays the stored row; every check, count and finish outcome of the page reads this.
 */
const isGreen = (f: AssessmentField): boolean => f.effectiveValidated ?? f.validated;
/** Green, or carrying an open comment (the assessor has said something on it). */
const isResolved = (f: AssessmentField): boolean => isGreen(f) || openComments(f).length > 0;
/**
 * Round 2 (Lead): a live `escalate` on the field, on a round-1 comment of its thread or on the Lead's own comment
 * (a withdrawn comment carries none). It keeps the field grey and lets Finish end `escalated` (contract § 4.3).
 */
const isEscalated = (f: AssessmentField): boolean =>
  (f.thread ?? []).some((t) => t.decision?.decision === 'escalate') ||
  f.comments.some((c) => c.state !== 'withdrawn' && c.decision?.decision === 'escalate');
/**
 * Round 2 (Lead): green, or escalated. A grey core field with neither is what the server refuses Finish for
 * (`ASSESSMENT_CORE_UNDECIDED`), whatever comments it carries.
 */
const isDecided = (f: AssessmentField): boolean => isGreen(f) || isEscalated(f);
/** Round 2 (Lead): the green is round 1's, unchanged, because the Lead stored nothing. */
const isCarried = (f: AssessmentField): boolean => isAssessed(f) && isGreen(f) && f.carried === true;

const CARRIED_LABEL = 'Green in round 1, unchanged';
const UPDATED_LABEL = 'Updated';

/**
 * The green/grey mark (FR-9, FR-23: icon and accessible name, never color alone) and the comment count. Round 2 adds,
 * with existing chip styles only, the carried-green hint and "Updated" (changed since round 1).
 * TODO(design): both round-2 chips borrow the `agreed` / `changes` looks until Juanpa designs them.
 */
function chips(f: AssessmentField): StateChip[] {
  const updated: StateChip[] = f.updated ? [{ kind: 'changes', label: UPDATED_LABEL, count: 0 }] : [];
  if (!isAssessed(f)) return updated;
  const states: StateChip[] = [
    isGreen(f)
      ? { kind: 'ok', label: 'Validated', count: 0 }
      : { kind: 'not', label: 'Not validated', count: 0 },
  ];
  if (isCarried(f)) states.push({ kind: 'agreed', label: CARRIED_LABEL, count: 0 });
  states.push(...updated);
  const open = openComments(f).length;
  if (open) states.push({ kind: 'com', label: 'Commented', count: open });
  return states;
}

/** Assessor buttons. Read only: only "View comments", and only when there are some (FR-2). */
function actions(f: AssessmentField, writable: boolean): FieldActions | null {
  if (!isAssessed(f)) return null;
  const count = openComments(f).length;
  const base: FieldActions = {
    approve: false,
    undo: null,
    highlight: null,
    decide: false,
    editNote: false,
    markDone: false,
    secondary: count > 0,
    secondaryLabel: 'View comments',
    count,
  };
  if (!writable) return count > 0 ? base : null;
  return {
    ...base,
    approve: !isGreen(f),
    undo: isGreen(f) ? 'approval' : null,
    secondary: true,
    secondaryLabel: count > 0 ? 'View comments' : 'Add comment',
  };
}

function cardStatus(f: AssessmentField, writable: boolean, id: string = f.key): CardStatusVm {
  return {
    id,
    states: chips(f),
    answeredDate: '',
    highlighted: false,
    instruction: '',
    ppuNote: '',
    // AI is not connected in step 1 (DD-13); P2-3918 sets this entry.
    ai: null,
    actions: actions(f, writable),
  };
}

// ---------- Round 2: the round-1 thread and the Lead's decisions (round-2 contract § 3.1, § 4.1) ----------

/**
 * What the page lets the Lead do on the threads. `decide`: the page offers writes at all (the controls then follow
 * each item's `decidable` / `choices` alone, never `writable`: contract § 3.1). `othersGreen`: every other core field
 * is effectively green, so an agree here may end the review.
 */
export interface LeadContext {
  readonly decide: boolean;
  readonly othersGreen: boolean;
  /** The page offers the delete of another reviewer's comment (`deleteOpen` and writes on). */
  readonly remove?: boolean;
  /** The caller's user id: one's own comment is withdrawn, never deleted. */
  readonly me?: number | null;
}
const NO_LEAD: LeadContext = { decide: false, othersGreen: false };

const DECISION_LABELS: Readonly<Record<LeadDecisionKind, { readonly offer: string; readonly taken: string }>> = {
  agree_program: { offer: 'Agree with the program', taken: 'Agreed with the program' },
  escalate: { offer: 'Escalate to TPB', taken: 'Escalated to TPB' },
};
/** The program's response as the drawer names it. */
const RESPONSE_LABELS: Readonly<Record<ProgramResponseKind, string>> = {
  accept: 'Accepted',
  accept_with_comment: 'Accepted with comment',
  disagree: 'Disagreed',
  request_clarification: 'Requested clarification',
};
/** Round-1 states a Lead decides (contract § 3.1). */
const TO_DECIDE: ReadonlySet<CommentState> = new Set<CommentState>(['disagreed', 'open', 'clarification_requested']);
/** A comment that keeps its field grey: escalated, or still waiting for a decision (contract § 4.1, § 4.2). */
const holdsGrey = (t: ThreadItem): boolean => t.decision?.decision === 'escalate' || (!t.decision && TO_DECIDE.has(t.state));

/** The round-1 thread of an actionable core field, as the card shows it. Empty anywhere else. */
function toThreadVm(f: AssessmentField, lead: LeadContext): ThreadItemVm[] {
  if (!isAssessed(f) || !f.thread?.length) return [];
  const now = formatValue(f);
  // The Lead's own escalated comment keeps the field grey too (contract § 3.2).
  const ownEscalate = f.comments.some((c) => c.decision?.decision === 'escalate');
  return f.thread.map((t, i, all) => {
    const then = formatValue({ value: t.valueCopy.value, labels: t.valueCopy.labels ?? f.labels, notApplicable: false, subfieldLists: f.subfieldLists });
    const choices = lead.decide && t.decidable ? t.choices.map((kind) => ({ kind, label: DECISION_LABELS[kind].offer })) : [];
    return {
      commentId: t.commentId,
      who: reviewerLabel(t.author),
      date: romeDay(t.createdAt),
      text: t.body,
      valueThen: then === now ? null : t.valueTruncated ? `${then}…` : then,
      response: t.response
        ? { who: t.response.respondedBy.name, label: RESPONSE_LABELS[t.response.kind], date: romeDay(t.response.respondedAt), text: t.response.body ?? '' }
        : null,
      clarifications: t.clarifications.map((c) => ({
        question: c.question,
        askedOn: romeDay(c.requestedAt),
        answer: c.answer?.body ?? null,
        answeredOn: c.answer ? romeDay(c.answer.answeredAt) : '',
      })),
      decision: t.decision
        ? { kind: t.decision.decision, label: DECISION_LABELS[t.decision.decision].taken, text: t.decision.body ?? '', date: romeDay(t.decision.decidedAt) }
        : null,
      choices,
      pending: t.decidable && !t.decision,
      own: false,
      // Contract § 4.4: not one the program answered, never one's own.
      canDelete: lead.remove === true && !t.response && t.author.id !== (lead.me ?? null),
      // Announced only, the server decides: agree greens the field once nothing else on it holds it grey.
      agreeEnds:
        lead.othersGreen && !ownEscalate && choices.some((c) => c.kind === 'agree_program') && all.every((o, j) => j === i || !holdsGrey(o)),
    };
  });
}

/**
 * The Lead's own live round-2 comments of an actionable field (contract § 3.2): the comments that carry the own-comment
 * keys (`decidable` present), withdrawn ones left out. Only "Escalate to TPB" (exactly `choices`); no program response.
 */
function toOwnVm(f: AssessmentField, lead: LeadContext): ThreadItemVm[] {
  if (!isAssessed(f)) return [];
  return f.comments
    .filter((c) => c.decidable !== undefined && c.state !== 'withdrawn')
    .map((c) => ({
      commentId: c.id,
      who: reviewerLabel(c.author),
      date: romeDay(c.createdAt),
      text: c.body,
      valueThen: null,
      response: null,
      clarifications: [],
      decision: c.decision
        ? { kind: c.decision.decision, label: DECISION_LABELS[c.decision.decision].taken, text: c.decision.body ?? '', date: romeDay(c.decision.decidedAt) }
        : null,
      choices: lead.decide && c.decidable ? (c.choices ?? []).map((kind) => ({ kind, label: DECISION_LABELS[kind].offer })) : [],
      pending: false,
      agreeEnds: false,
      own: true,
      canDelete: false,
    }));
}

export function toFieldVm(f: AssessmentField, writable: boolean, lead: LeadContext = NO_LEAD): FieldVm {
  const leadThread = toThreadVm(f, lead);
  return {
    ...cardStatus(f, writable),
    label: fieldLabel(f.key, f.label),
    // Reporting's help text of the field (catalog `description`); absent = no tooltip.
    tip: f.description ?? '',
    isCore: isAssessed(f) && f.core,
    isHidden: false,
    isView: !isAssessed(f),
    value: formatValue(f),
    before: null,
    scale: null,
    iaGroupStart: false,
    carried: isCarried(f),
    updated: f.updated === true,
    leadThread,
    leadOwn: toOwnVm(f, lead),
    threadOpen: leadThread.some((t) => t.pending),
  };
}

// ---------- Theory of Change ----------

const blankCard = (status: CardStatusVm): TocCardVm => ({
  ...status,
  eyebrow: '',
  levelChip: '',
  links: [],
  contrib: null,
  target: null,
});

const asNumber = (v: Json): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() && !isNaN(+v) ? +v : null;

/** One ToC contribution: level chip, the chain of links, contribution and target (every element shown, FR-9). */
function contributionCard(
  entry: Readonly<Record<string, Json>>,
  n: number,
  labels: FieldLabels | null,
  status: CardStatusVm,
): TocCardVm {
  const links: TocLinkVm[] = Object.entries(entry)
    .filter(([k, v]) => k !== 'target' && k !== 'contribution_to_target' && !isEmpty(v))
    .map(([k, v]) => ({
      label: humanize(k),
      code: '',
      value: Array.isArray(v)
        ? v.map((x) => entryText(x, labels)).join('; ')
        : scalarText(v, labels, SUBFIELD_LISTS[k], k in SUBFIELD_LISTS),
    }));
  return {
    ...blankCard(status),
    eyebrow: `Contribution ${n}`,
    levelChip: isEmpty(entry['level'])
      ? ''
      : labelOf(entry['level'], labels, SUBFIELD_LISTS['level']),
    links,
    contrib: asNumber(entry['contribution_to_target']),
    target: asNumber(entry['target']),
  };
}

/** A ToC field shown as one card (a yes/no answer, a narrative, an empty list). */
function answerCard(f: AssessmentField, status: CardStatusVm): TocCardVm {
  return {
    ...blankCard(status),
    eyebrow: f.label,
    levelChip: f.core && isAssessed(f) ? 'Core' : '',
    links: [{ label: 'Answer', code: '', value: formatValue(f) }],
    tip: f.description ?? '',
  };
}

/**
 * The Theory of Change section (FR-9, OQ-7): complete, whatever the configuration. `toc.entries` gives one card per
 * contribution, `contributors.science_programs` one group per contributing program. A field's mark and buttons sit
 * on its first card (`id` = the field key); its other cards read `key#n`.
 */
export function toTocVm(fields: readonly AssessmentField[], writable: boolean, lead?: (f: AssessmentField) => LeadContext): TocVm {
  const main: TocCardVm[] = [];
  const programGroups: TocGroupVm[] = [];
  let count = 0;
  for (const f of fields) {
    // Round 2 (Lead): the field's round-1 thread and own comments go on its first card, as on a field card.
    const context = lead?.(f) ?? NO_LEAD;
    const leadThread = toThreadVm(f, context);
    const thread = { leadThread, leadOwn: toOwnVm(f, context), threadOpen: leadThread.some((t) => t.pending) };
    const status = (i: number) =>
      i === 0
        ? { ...cardStatus(f, writable), ...thread }
        : { ...cardStatus(f, false, `${f.key}#${i}`), states: [], actions: null };
    const listed =
      !f.notApplicable && Array.isArray(f.value) && f.value.every(isObject)
        ? (f.value as readonly Readonly<Record<string, Json>>[])
        : [];
    const entries = listed.filter((e) => !isBlankEntry(e));
    if (!entries.length) {
      main.push(answerCard(f, status(0)));
      continue;
    }
    if (f.key === 'contributors.science_programs') {
      let card = 0;
      entries.forEach((entry, p) => {
        const nested = Array.isArray(entry['toc_entries'])
          ? (entry['toc_entries'] as readonly Json[])
              .filter(isObject)
              .filter((e) => !isBlankEntry(e))
          : [];
        const { toc_entries: _, ...rest } = entry;
        const items = nested.length
          ? nested.map((e, i) => contributionCard(e, i + 1, f.labels, status(card++)))
          : [{ ...contributionCard(rest, 1, f.labels, status(card++)), eyebrow: f.label }];
        if (nested.length)
          items[0] = {
            ...items[0],
            links: [...contributionCard(rest, 0, f.labels, status(0)).links, ...items[0].links],
          };
        count += nested.length;
        const name = isEmpty(entry['program'])
          ? `Program ${p + 1}`
          : labelOf(entry['program'], f.labels, SUBFIELD_LISTS['program']);
        programGroups.push({
          code: `${p + 1}`,
          name,
          countText: nested.length + (nested.length === 1 ? ' contribution' : ' contributions'),
          showHead: true,
          items,
        });
      });
      continue;
    }
    entries.forEach((entry, i) => main.push(contributionCard(entry, i + 1, f.labels, status(i))));
    count += entries.length;
  }
  const groups: TocGroupVm[] = [
    ...(main.length ? [{ code: '', name: '', countText: '', showHead: false, items: main }] : []),
    ...programGroups,
  ];
  return {
    groups,
    count,
    programs: Math.max(programGroups.length, count > 0 ? 1 : 0),
    reviewed: fields.filter((f) => isAssessed(f) && isGreen(f)).length,
    assessed: fields.filter(isAssessed).length,
  };
}

// ---------- Page ----------

/** The read-only banner (FR-23). `stepName` is the role's step of the timeline. */
export function readOnlyBanner(
  reason: AssessmentReadOnlyReason | null,
  view: Pick<AssessmentView, 'assessment' | 'header'> & Pick<Partial<AssessmentView>, 'actingRoles'>,
): string | null {
  const step = view.header.step
    ? `Step ${view.header.step.position} · ${view.header.step.name}`
    : 'Your step';
  switch (reason) {
    case null:
      return null;
    case 'admin_read_only':
      return view.actingRoles?.length
        ? 'View only. To act as a reviewer on this result, pick a role in "Act as".'
        : 'View only for admins: you are not assigned to assess this timeline.';
    case 'step_upcoming':
      return `${step} has not opened yet. You can read the assessment.`;
    case 'step_closed':
      return `${step} is closed. The assessment is read only.`;
    case 'no_step':
      return 'Your role has no step in this timeline. The assessment is read only.';
    case 'auto_validated':
      return 'Auto-validated: this result is not assessed.';
    case 'finished': {
      const a = view.assessment;
      const who = reviewerLabel(a?.assessedBy);
      return `Finished by ${who}${a?.finishedAt ? ' on ' + romeDay(a.finishedAt) : ''}.`;
    }
    default:
      return 'The assessment is read only.';
  }
}

export function toHeaderVm(view: AssessmentView, canAct: boolean = view.writable): ResultHeaderVm {
  const h = view.header;
  const pill = qaStatusPill(h.status);
  const a = view.assessment;
  const ended = !!a && a.status !== 'pending';
  const assessor = reviewerLabel(a?.assessedBy);
  const programName = `${h.program.code} ${h.program.name}`.trim();
  const step = h.step ? `Step ${h.step.position} · ${h.step.name}` : null;
  return {
    code: String(h.resultCode),
    title: h.title ?? 'Untitled result',
    type: h.resultType.label,
    programCode: h.program.code,
    programName,
    timeline: h.timeline.name,
    step: step ?? 'No step',
    status: pill.label,
    statusClass: pill.cls,
    isAuto: h.status === 'auto_validated',
    assessor,
    showAssessedBy: ended,
    instructions: isAutoValidated(view)
      ? AUTO_VALIDATED_INSTRUCTIONS
      : canAct
        ? ASSESSOR_INSTRUCTIONS
        : view.writable
          ? READING_INSTRUCTIONS
          : READ_ONLY_INSTRUCTIONS,
    // Comments become visible to the program only when the assessment ends (FR-14, FR-15).
    locked: canAct && !ended,
    details: [
      { label: 'Science program', value: programName },
      { label: 'Timeline', value: h.timeline.name },
      { label: 'Step', value: step ?? '—' },
      { label: 'Assessed by', value: ended ? assessor : '—' },
    ],
  };
}

/**
 * The status Finish would give now. Round 1: returned while a core field is grey or any comment stands. Round 2
 * (contract § 4.3): Quality Assessed when no core field is effectively grey, else escalated, which the result shows
 * as Pending for TPB review (a grey core field with no escalate is refused by the server, not announced here).
 */
function finishOutcome(view: AssessmentView, assessed: readonly AssessmentField[]): string {
  const grey = assessed.some((f) => f.core && !isGreen(f));
  if (view.round === 2) return grey ? STATUS_LABELS.pending_tpb_review : STATUS_LABELS.quality_assessed;
  return grey || returnsOnAnyComment(view) ? STATUS_LABELS.returned_to_program : STATUS_LABELS.quality_assessed;
}

/**
 * `writes` off = the page shows what the API says but offers no write button (validate, comment, finish), even to
 * a caller who may write. The banner and `writable` still say what the API said.
 */
export function toReviewVm(view: AssessmentView, writes = true, me: number | null = null): ReviewVm {
  const writable = view.writable;
  // Nothing is assessed on an auto-validated result, whatever the caller may write elsewhere.
  const auto = isAutoValidated(view);
  const canAct = writable && writes && !auto;
  const roundTwo = view.round === 2;
  const fieldsOf = (fields: readonly AssessmentField[]): readonly AssessmentField[] =>
    auto ? fields.map(asContext) : roundTwo ? fields.map(leadContext) : fields;
  const assessed = view.sections.flatMap((s) => fieldsOf(s.fields)).filter(isAssessed);
  const greyCores = assessed.filter((f) => f.core && !isGreen(f)).map((f) => f.key);
  const remove = canAct && deleteOpen(view);
  // What counts as done on a field: green or commented in round 1; green or escalated in round 2 (the Lead).
  const resolved = roundTwo ? isDecided : isResolved;
  const lead = (f: AssessmentField): LeadContext => ({ decide: writes && !auto, othersGreen: greyCores.every((k) => k === f.key), remove, me });
  const sections: ReviewSectionVm[] = view.sections.map((s) => {
    const isToc = s.key === TOC_SECTION_KEY;
    const fields = fieldsOf(s.fields);
    return {
      key: s.key,
      name: s.label,
      isToc,
      fields: isToc ? [] : fields.map((f) => toFieldVm(f, canAct, lead(f))),
      toc: isToc ? toTocVm(fields, canAct, lead) : null,
      open: fields.filter((f) => isAssessed(f) && !resolved(f)).length,
    };
  });
  if (view.other.length) {
    sections.push({
      key: OTHER_SECTION_KEY,
      name: 'Other fields',
      isToc: false,
      fields: view.other.map((f) => toFieldVm({ ...f, mode: 'view' }, false)),
      toc: null,
      open: 0,
    });
  }
  // The server's refusal (`endOnFinish`): a grey core field with no non-withdrawn comment.
  // Round 2 (contract § 4.3): `ASSESSMENT_CORE_UNDECIDED`, a grey core field with no escalate.
  const blocked = assessed.filter((f) => f.core && !resolved(f));
  const finishBlockedBy = blocked.map((f) => f.label);
  return {
    header: toHeaderVm(view, canAct),
    sections,
    writable,
    banner: auto ? AUTO_VALIDATED_BANNER : readOnlyBanner(view.readOnlyReason, view),
    resolved: assessed.filter(resolved).length,
    total: assessed.length,
    commented: assessed.filter((f) => openComments(f).length > 0).length,
    validated: assessed.filter(isGreen).length,
    canFinish: canAct && (view.assessment?.status ?? 'pending') === 'pending',
    finishTo: finishBlockedBy.length ? '' : finishOutcome(view, assessed),
    finishBlockedBy,
    finishBlockedFields: blocked.map((f) => ({ key: f.key, label: f.label })),
  };
}

/**
 * Why Finish is refused, in the words the page uses for the 409 `ASSESSMENT_CORE_UNCOMMENTED` (one or several core
 * field labels); empty when nothing blocks it.
 */
/**
 * Round 2 (Lead): why Finish is refused, in the words the page uses for the 409 `ASSESSMENT_CORE_UNDECIDED` (contract
 * § 4.3); empty when nothing blocks it.
 */
export function coreUndecidedMessage(names: readonly string[]): string {
  return names.length ? `Validate or escalate ${names.length === 1 ? 'this core field' : 'these core fields'} first: ${names.join(', ')}.` : '';
}

export function coreUncommentedMessage(names: readonly string[]): string {
  return names.length ? `Validate or comment ${names.length === 1 ? 'this core field' : 'these core fields'} first: ${names.join(', ')}.` : '';
}

/** A field by key, with the name of its section (the drawer's subtitle). */
export function findField(
  view: AssessmentView,
  key: string,
): { readonly field: AssessmentField; readonly section: string } | null {
  for (const s of view.sections) {
    const field = s.fields.find((f) => f.key === key);
    if (field) return { field, section: s.label };
  }
  return null;
}

/**
 * One comment of a field's thread (P2-3910 AC14): nickname, date and time in Rome, step, and the field value as the
 * author saw it. `field` lends its subfield lists so the copy reads like the field does.
 */
export function toCommentVm(
  c: AssessmentComment,
  reader: ThreadReader = NO_READER,
  field: Pick<AssessmentField, 'subfieldLists'> = {},
): ReviewCommentVm {
  return {
    id: c.id,
    authorId: c.author.id,
    open: c.state === 'open',
    canWithdraw: reader.canWithdraw && c.state === 'open' && reader.me !== null && c.author.id === reader.me,
    // Round 2 (Lead): another reviewer's open comment (contract § 4.4); the program never sees round-2 comments.
    canDelete: reader.canDelete === true && c.state === 'open' && reader.me !== null && c.author.id !== reader.me,
    who: reviewerLabel(c.author),
    role: 'Assessor',
    date: romeStamp(c.createdAt),
    text: c.body,
    step: `Step ${c.stepPosition}`,
    valueCopy: formatValue({
      value: c.valueCopy?.value ?? null,
      labels: c.valueCopy?.labels ?? null,
      notApplicable: false,
      subfieldLists: field.subfieldLists,
    }),
    valueTruncated: c.valueTruncated === true,
  };
}

/** The program's threads of a result, by comment id (`GET …/sp-responses`). */
export type CommentThreads = ReadonlyMap<number, CommentThread>;

const NO_THREADS: CommentThreads = new Map();

const REPLY_OF: Readonly<Record<ProgramResponseKind, NonNullable<FieldComment['reply']>>> = {
  accept: 'accepted',
  accept_with_comment: 'accepted_with_comment',
  disagree: 'disagreed',
  request_clarification: 'clarification',
};

/**
 * What follows a comment in its thread (P2-3911): each response of the program, oldest first, and under a
 * clarification request the author's answer to it. The program is named with its email (AC12).
 */
export function toThreadRows(c: AssessmentComment, thread: CommentThread | undefined): FieldComment[] {
  if (!thread) return [];
  return thread.history.flatMap((r): FieldComment[] => {
    const row: FieldComment = {
      who: r.respondedBy.name,
      email: r.respondedBy.email,
      role: 'Program',
      date: romeDay(r.respondedAt),
      text: r.body ?? '',
      reply: REPLY_OF[r.kind],
    };
    const answer = r.kind === 'request_clarification' ? thread.clarifications.find((x) => x.requestId === r.id)?.answer : null;
    return answer
      ? [row, { who: reviewerLabel(c.author), role: 'Assessor', date: romeDay(answer.answeredAt), text: answer.body, answer: true }]
      : [row];
  });
}

/**
 * The one rule of P2-3911 for "the caller owes an answer on this comment": the clarification request still
 * unanswered, or null. The server says which threads the caller can answer now (`answerable`: author, pending
 * request, programs step open). A server that does not send it falls back to what the page can tell: a comment the
 * caller wrote, left in `clarification_requested`. Used by the drawer's form and by the page's cue alike.
 */
function owedClarification(
  c: AssessmentComment,
  me: number | null,
  threads: CommentThreads,
): CommentClarification | null {
  if (me === null) return null;
  const thread = threads.get(c.id);
  if (!(thread?.answerable ?? (c.state === 'clarification_requested' && c.author.id === me))) return null;
  return [...(thread?.clarifications ?? [])].reverse().find((x) => x.answer === null) ?? null;
}

/** The clarification the caller has to answer on a field (its first comment that owes one). */
export function pendingClarification(
  f: AssessmentField,
  me: number | null,
  threads: CommentThreads,
): { readonly commentId: number; readonly question: string } | null {
  for (const c of openComments(f)) {
    const pending = owedClarification(c, me, threads);
    if (pending) return { commentId: c.id, question: pending.question };
  }
  return null;
}

/** A comment of the caller on which the program awaits an answer, and where it sits on the page. */
export interface PendingAnswer {
  readonly sectionKey: string;
  readonly fieldKey: string;
  readonly fieldLabel: string;
  readonly commentId: number;
}

/**
 * Every comment of the result the caller can answer now, in page order (sections, then fields, then comments).
 * Only the sections' fields: the drawer opens those (`findField`); "Other fields" carry no button.
 */
export function pendingAnswers(view: AssessmentView, me: number | null, threads: CommentThreads): readonly PendingAnswer[] {
  return view.sections.flatMap((s) =>
    s.fields.flatMap((f) =>
      openComments(f)
        .filter((c) => owedClarification(c, me, threads) !== null)
        .map((c) => ({ sectionKey: s.key, fieldKey: f.key, fieldLabel: f.label, commentId: c.id })),
    ),
  );
}

const ANSWER_LABEL = 'Answer clarification';
const READ_ONLY_CLARIFY_INSTRUCTIONS =
  'This assessment is read only for you, except for the clarification the program asked on your comment.';

/**
 * The page once the caller owes an answer (P2-3911): the card of each such field offers "Answer clarification"
 * (same click, same count), and the read-only note names the exception. With nothing owed, the page as it was.
 */
export function withPendingAnswers(page: ReviewVm, pending: readonly PendingAnswer[]): ReviewVm {
  if (!pending.length) return page;
  const keys = new Set(pending.map((p) => p.fieldKey));
  const relabel = <T extends CardStatusVm>(card: T): T =>
    card.actions?.secondary && keys.has(card.id) ? { ...card, actions: { ...card.actions, secondaryLabel: ANSWER_LABEL } } : card;
  return {
    ...page,
    header:
      page.header.instructions === READ_ONLY_INSTRUCTIONS
        ? { ...page.header, instructions: READ_ONLY_CLARIFY_INSTRUCTIONS }
        : page.header,
    sections: page.sections.map((s) => ({
      ...s,
      fields: s.fields.map(relabel),
      toc: s.toc && { ...s.toc, groups: s.toc.groups.map((g) => ({ ...g, items: g.items.map(relabel) })) },
    })),
  };
}

/** The banner text that replaces the read-only one while the caller owes an answer; null when nothing is owed. */
export function pendingAnswersBanner(pending: readonly PendingAnswer[]): string | null {
  if (!pending.length) return null;
  return pending.length === 1
    ? `The program asked for a clarification on your comment in “${pending[0].fieldLabel}”. You can answer it while the program's step is open.`
    : `The program asked for a clarification on ${pending.length} of your comments. You can answer them while the program's step is open.`;
}

/**
 * The comments drawer of one field. `me` is the caller's user id: they may withdraw their own open comments (T-20)
 * and answer a clarification the program requested on one of them, whatever `mode` says (P2-3911).
 */
export function toDrawerVm(
  found: { readonly field: AssessmentField; readonly section: string },
  mode: CommentsDrawerMode,
  reader: ThreadReader = NO_READER,
  threads: CommentThreads = NO_THREADS,
): CommentsDrawerVm {
  const comments = openComments(found.field).flatMap((c) => [toCommentVm(c, reader, found.field), ...toThreadRows(c, threads.get(c.id))]);
  const clarify = reader.canClarify === false ? null : pendingClarification(found.field, reader.me, threads);
  return {
    label: found.field.label,
    section: found.section,
    value: formatValue(found.field),
    highlighted: false,
    comments,
    mode: clarify ? 'clarify' : mode,
    instruction: '',
    ppuNote: '',
    withdrawIndex: -1,
    clarify,
  };
}
