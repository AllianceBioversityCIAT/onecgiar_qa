// @akili-spec assessment/step-1-assessment
import {
  AssessmentComment,
  AssessmentField,
  AssessmentView,
  CommentClarification,
  CommentThread,
  FieldLabels,
  AssessmentReadOnlyReason,
  ProgramResponseKind,
  TOC_SECTION_KEY,
} from '../../../core/api/assessment.models';
import { reviewerLabel } from '../../../core/api/acting-role';
import { formatDay, todayInRome } from '../../../core/domain/rome-date';
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
}

/** Who reads the thread: the caller's user id, and whether their step still lets them take a comment back. */
export interface ThreadReader {
  readonly me: number | null;
  readonly canWithdraw: boolean;
  /** False once the server said the programs step is closed: the clarification form is not offered (P2-3911). */
  readonly canClarify?: boolean;
}

const NO_READER: ThreadReader = { me: null, canWithdraw: false };

/**
 * A comment can be taken back while the caller writes on the assessment, and also after it ended (the server allows
 * it while step 1 or 2 is open, FR-13). Any other read-only reason (admin, step closed, no step) offers nothing.
 */
export function withdrawOpen(view: Pick<AssessmentView, 'writable' | 'readOnlyReason'>): boolean {
  return view.writable || view.readOnlyReason === 'finished';
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
   * Status the result takes if it is finished now: returned while a core field is grey, and in step 1 also
   * while any comment still stands (`returnsOnAnyComment`); Quality Assessed otherwise.
   */
  readonly finishTo: string;
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
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * One entry of a list field: "Level: Outcome · Target: 4". A subfield is labelled when `lists` names its control
 * list: the ToC ones always, the others from the field's `subfieldLists` (e.g. "Actor type: Farmers", not "1").
 */
function entryText(
  entry: Json,
  labels: FieldLabels | null,
  lists: Readonly<Record<string, string>> = SUBFIELD_LISTS,
): string {
  if (!isObject(entry)) return scalarText(entry, labels, undefined, !!labels);
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
/** Green, or carrying an open comment (the assessor has said something on it). */
const isResolved = (f: AssessmentField): boolean => f.validated || openComments(f).length > 0;

/** The green/grey mark (FR-9, FR-23: icon and accessible name, never color alone) and the comment count. */
function chips(f: AssessmentField): StateChip[] {
  if (!isAssessed(f)) return [];
  const states: StateChip[] = [
    f.validated
      ? { kind: 'ok', label: 'Validated', count: 0 }
      : { kind: 'not', label: 'Not validated', count: 0 },
  ];
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
    approve: !f.validated,
    undo: f.validated ? 'approval' : null,
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

export function toFieldVm(f: AssessmentField, writable: boolean): FieldVm {
  return {
    ...cardStatus(f, writable),
    label: f.label,
    // Reporting's help text of the field (catalog `description`); absent = no tooltip.
    tip: f.description ?? '',
    isCore: isAssessed(f) && f.core,
    isHidden: false,
    isView: !isAssessed(f),
    value: formatValue(f),
    before: null,
    scale: null,
    iaGroupStart: false,
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
export function toTocVm(fields: readonly AssessmentField[], writable: boolean): TocVm {
  const main: TocCardVm[] = [];
  const programGroups: TocGroupVm[] = [];
  let count = 0;
  for (const f of fields) {
    const status = (i: number) =>
      i === 0
        ? cardStatus(f, writable)
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
    reviewed: fields.filter((f) => isAssessed(f) && f.validated).length,
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
  return {
    code: String(h.resultCode),
    title: h.title ?? 'Untitled result',
    type: h.resultType.label,
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
      { label: 'Science program', value: `${h.program.code} ${h.program.name}`.trim() },
      { label: 'Timeline', value: h.timeline.name },
      { label: 'Step', value: h.step ? `Step ${h.step.position} · ${h.step.name}` : '—' },
      { label: 'Assessed by', value: ended ? assessor : '—' },
    ],
  };
}

/**
 * `writes` off = the page shows what the API says but offers no write button (validate, comment, finish), even to
 * a caller who may write. The banner and `writable` still say what the API said.
 */
export function toReviewVm(view: AssessmentView, writes = true): ReviewVm {
  const writable = view.writable;
  // Nothing is assessed on an auto-validated result, whatever the caller may write elsewhere.
  const auto = isAutoValidated(view);
  const canAct = writable && writes && !auto;
  const fieldsOf = (fields: readonly AssessmentField[]): readonly AssessmentField[] =>
    auto ? fields.map(asContext) : fields;
  const sections: ReviewSectionVm[] = view.sections.map((s) => {
    const isToc = s.key === TOC_SECTION_KEY;
    const fields = fieldsOf(s.fields);
    return {
      key: s.key,
      name: s.label,
      isToc,
      fields: isToc ? [] : fields.map((f) => toFieldVm(f, canAct)),
      toc: isToc ? toTocVm(fields, canAct) : null,
      open: fields.filter((f) => isAssessed(f) && !isResolved(f)).length,
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
  const assessed = view.sections.flatMap((s) => fieldsOf(s.fields)).filter(isAssessed);
  return {
    header: toHeaderVm(view, canAct),
    sections,
    writable,
    banner: auto ? AUTO_VALIDATED_BANNER : readOnlyBanner(view.readOnlyReason, view),
    resolved: assessed.filter(isResolved).length,
    total: assessed.length,
    commented: assessed.filter((f) => openComments(f).length > 0).length,
    validated: assessed.filter((f) => f.validated).length,
    canFinish: canAct && (view.assessment?.status ?? 'pending') === 'pending',
    finishTo:
      assessed.some((f) => f.core && !f.validated) || returnsOnAnyComment(view)
        ? STATUS_LABELS.returned_to_program
        : STATUS_LABELS.quality_assessed,
  };
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

export function toCommentVm(c: AssessmentComment, reader: ThreadReader = NO_READER): ReviewCommentVm {
  return {
    id: c.id,
    authorId: c.author.id,
    open: c.state === 'open',
    canWithdraw: reader.canWithdraw && c.state === 'open' && reader.me !== null && c.author.id === reader.me,
    who: reviewerLabel(c.author),
    role: 'Assessor',
    date: romeDay(c.createdAt),
    text: c.body,
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
  const comments = openComments(found.field).flatMap((c) => [toCommentVm(c, reader), ...toThreadRows(c, threads.get(c.id))]);
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
