// View models and pure helpers for the Review page. One page for every reviewing role; only the buttons change.
import type { DecisionKind } from '../../../core/api/assessment.models';
import {
  AiMatch,
  FieldDef,
  FieldState,
  IA_SCALE,
  PROGRAMS,
  ReviewResult,
  ReviewRole,
  TOC_PROG_NAMES,
  TocDef,
  fieldValue,
} from './review.mock';

export type StateKind = 'not' | 'ok' | 'com' | 'ans' | 'hl' | 'agreed' | 'changes' | 'done';

/** Everything a card can ask the view to do. */
export type CardAction =
  | 'approve'
  | 'undo'
  | 'comment'
  | 'highlight'
  | 'unhighlight'
  | 'agree'
  | 'changes'
  | 'edit-note'
  | 'done'
  | 'ai-toggle'
  | 'ai-hide'
  | 'ai-dismiss'
  | 'ai-use';

export interface StateChip {
  readonly kind: StateKind;
  readonly label: string;
  readonly count: number;
}

export interface AiVm {
  readonly mismatch: boolean;
  readonly text: string;
  /** Reasoning visible (always for mismatches; toggled for "Looks consistent"). */
  readonly expanded: boolean;
}

export interface FieldActions {
  /** Assessor. */
  readonly approve: boolean;
  /** What "Undo" takes back: the assessor's approval, the TPB's decision or the PPU's "done". */
  readonly undo: 'approval' | 'decision' | 'done' | null;
  /** Lead assessor: "Mark as highlight", or "Edit instruction" + "Remove highlight" once highlighted. */
  readonly highlight: 'mark' | 'edit' | null;
  /** Third-party broker: "Agreed with program" / "Required changes" (which opens the note for the PPU). */
  readonly decide: boolean;
  /** Third-party broker, after "Required changes": "Edit note" for the PPU. */
  readonly editNote: boolean;
  /** PPU: "Mark when done". */
  readonly markDone: boolean;
  readonly secondary: boolean;
  readonly secondaryLabel: string;
  readonly count: number;
}

/** Shared by field cards and theory-of-change cards. */
export interface CardStatusVm {
  readonly id: string;
  readonly states: readonly StateChip[];
  /** "09 Jul" when the last entry is an update from the reporting tool. */
  readonly answeredDate: string;
  readonly highlighted: boolean;
  /** Lead assessor's instruction for the third-party broker, shown on the card while highlighted. */
  readonly instruction: string;
  /** Third-party broker's note for the PPU, shown on the card after "Required changes". */
  readonly ppuNote: string;
  readonly ai: AiVm | null;
  readonly actions: FieldActions | null;
}

export interface ScaleCell {
  readonly n: number;
  readonly label: string;
  readonly selected: boolean;
}

export interface FieldVm extends CardStatusVm {
  readonly label: string;
  readonly tip: string;
  readonly isCore: boolean;
  readonly isHidden: boolean;
  readonly isView: boolean;
  readonly value: string;
  /** Previous value, when the field shows the Before / Now compare. */
  readonly before: string | null;
  readonly scale: readonly ScaleCell[] | null;
  readonly iaGroupStart: boolean;
  /**
   * Round 2 (Lead): the green is the one carried from round 1, because the Lead stored nothing. Always false in
   * round 1. TODO(design): the card shows it today as a neutral state chip; Juanpa decides its final look.
   */
  readonly carried: boolean;
  /**
   * Round 2 (Lead): the field changed since round 1. Always false in round 1. TODO(design): shown today as an
   * "Updated" state chip with an existing style; Juanpa decides its final look.
   */
  readonly updated: boolean;
  /**
   * Round 2 (Lead): the round-1 comments of a core field, with what the program answered and the Lead's decision.
   * Empty in round 1 and on any field that is not actionable.
   */
  readonly leadThread: readonly ThreadItemVm[];
  /** Round 2 (Lead): the Lead's own live round-2 comments on the field, with their escalate control (contract § 3.2). */
  readonly leadOwn: readonly ThreadItemVm[];
  /** Round 2 (Lead): the thread opens by default while one of its comments still waits for the Lead's decision. */
  readonly threadOpen: boolean;
}

/** A decision the Lead may take on a comment ("Agree with the program", "Escalate to TPB"). */
export interface DecisionChoiceVm {
  readonly kind: DecisionKind;
  readonly label: string;
}

/** One round-1 comment as the Lead reads it in the card (round-2 contract § 3.1). */
export interface ThreadItemVm {
  readonly commentId: number;
  /** The assessor, by nickname ("Admin · nickname" for an admin). */
  readonly who: string;
  readonly date: string;
  readonly text: string;
  /** The value when the assessor commented, only when it differs from the value now. */
  readonly valueThen: string | null;
  /** The program's latest response, or null when it never responded. */
  readonly response: {
    readonly who: string;
    readonly label: string;
    readonly date: string;
    readonly text: string;
  } | null;
  /** Every clarification request with its answer, oldest first. */
  readonly clarifications: readonly {
    readonly question: string;
    readonly askedOn: string;
    readonly answer: string | null;
    readonly answeredOn: string;
  }[];
  /** The Lead's current decision, or null. */
  readonly decision: {
    readonly kind: DecisionKind;
    readonly label: string;
    readonly text: string;
    readonly date: string;
  } | null;
  /** Exactly the server's `choices` while the comment is decidable (and the page offers writes); `[]` otherwise. */
  readonly choices: readonly DecisionChoiceVm[];
  /** Still waits for the Lead: decidable, no decision yet. */
  readonly pending: boolean;
  /**
   * An agree here would leave every core field green, so the review finishes in the same call (contract § 4.1).
   * Announced only: the server decides.
   */
  readonly agreeEnds: boolean;
  /** The Lead's own round-2 comment (contract § 3.2): no program response, only "Escalate to TPB". */
  readonly own: boolean;
  /** The Lead may delete it (another reviewer's comment the program never answered, while the Lead writes). */
  readonly canDelete: boolean;
}

export interface TocLinkVm {
  readonly label: string;
  readonly code: string;
  readonly value: string;
}

export interface TocCardVm extends CardStatusVm {
  readonly eyebrow: string;
  readonly levelChip: string;
  readonly links: readonly TocLinkVm[];
  readonly contrib: number | null;
  readonly target: number | null;
  /**
   * Help text of the field the card stands for ('' = none). Left out on a contribution card, which carries the
   * general note about contributions instead.
   */
  readonly tip?: string;
  /** Round 2 (Lead): on the field's first card only, its round-1 thread and the Lead's own comments (as `FieldVm`). */
  readonly leadThread?: readonly ThreadItemVm[];
  readonly leadOwn?: readonly ThreadItemVm[];
  readonly threadOpen?: boolean;
}

export interface TocGroupVm {
  readonly code: string;
  readonly name: string;
  readonly countText: string;
  readonly showHead: boolean;
  readonly items: readonly TocCardVm[];
}

export interface SectionNavVm {
  readonly name: string;
  readonly n: number;
  readonly active: boolean;
  /** Fields in the section that still need the assessor. */
  readonly open: number;
}

export interface ResultHeaderVm {
  readonly code: string;
  readonly title: string;
  readonly type: string;
  /** Science Program code ("SP09"), shown in the header (P2-4136, AC3); the full name goes in `programName`. */
  readonly programCode: string;
  /** "SP09 Climate Action": the program's title on hover and in the ⓘ details. */
  readonly programName: string;
  /** Timeline name, shown under the title (P2-4136, AC3). */
  readonly timeline: string;
  /** "Step 1 · Assessment", or "No step" when the caller's role has none on the timeline. */
  readonly step: string;
  readonly status: string;
  readonly statusClass: string;
  readonly isAuto: boolean;
  readonly assessor: string;
  readonly showAssessedBy: boolean;
  readonly instructions: string;
  readonly locked: boolean;
  readonly details: readonly { readonly label: string; readonly value: string }[];
}

export const isAssessable =(d: FieldDef): boolean => d.mode === 'core' || d.mode === 'assessed';

/**
 * Assessor: approved, or the last word in the thread is the assessor's comment. ToC needs approval.
 * A program's answer, rejection included, opens the field again for the assessor (Santi via Yeck, 2026-11-12).
 */
export function isResolved(d: FieldDef, fs: FieldState): boolean {
  if (d.sec === 'toc') return fs.approved;
  const last = fs.comments[fs.comments.length - 1];
  return fs.approved || (!!last && last.role === 'Assessor');
}

/** The program rejected the assessor's comment (its last answer in the thread). */
export function programRejected(fs: FieldState): boolean {
  const answers = fs.comments.filter((c) => c.role === 'Program');
  return answers[answers.length - 1]?.reply === 'rejected';
}

/**
 * Fields a role works on, and whether each one still needs it.
 * Lead assessor: every field with an assessor's comment; they mark as highlight the ones they see fit, rejected or not.
 * There is no final step for them (Santi via Yeck, 2026-11-12).
 * TPB: highlighted fields, until decided. PPU: "Required changes", until done.
 */
export function roleScope(role: ReviewRole, d: FieldDef, fs: FieldState): { readonly mine: boolean; readonly open: boolean } {
  switch (role) {
    case 'assessor':
      return { mine: true, open: !isResolved(d, fs) };
    case 'lead': {
      const mine = fs.comments.some((c) => c.role === 'Assessor');
      return { mine, open: mine && !fs.highlighted };
    }
    case 'tpb':
      return { mine: fs.highlighted, open: fs.highlighted && !fs.decision };
    case 'ppu': {
      const mine = fs.highlighted && fs.decision === 'changes';
      return { mine, open: mine && !fs.done };
    }
  }
}

/** "09 Jul 2026" → "09 Jul". */
export const dShort = (date: string): string => date.replace(/\s+\d{4}\s*$/, '');

export function stateChips(fs: FieldState): StateChip[] {
  const cnt = fs.comments.length;
  const last = fs.comments[cnt - 1];
  const chips: StateChip[] = [];
  if (fs.approved) chips.push({ kind: 'ok', label: 'Approved', count: 0 });
  else if (last && last.role !== 'Assessor')
    chips.push({ kind: 'ans', label: programRejected(fs) ? 'Rejected by program' : 'Answered', count: 0 });
  else if (cnt) chips.push({ kind: 'com', label: 'Commented', count: cnt });
  if (fs.highlighted) chips.push({ kind: 'hl', label: 'Highlighted', count: 0 });
  if (fs.highlighted && fs.decision === 'agreed') chips.push({ kind: 'agreed', label: 'Agreed with program', count: 0 });
  if (fs.highlighted && fs.decision === 'changes')
    chips.push(fs.done ? { kind: 'done', label: 'Changes done', count: 0 } : { kind: 'changes', label: 'Required changes', count: 0 });
  if (!chips.length) chips.push({ kind: 'not', label: 'Not reviewed', count: 0 });
  return chips;
}

/** The buttons a role gets on one card (null: nothing for this role here). */
function roleActions(role: ReviewRole, fs: FieldState): FieldActions | null {
  const cnt = fs.comments.length;
  const none: FieldActions = {
    approve: false,
    undo: null,
    highlight: null,
    decide: false,
    editNote: false,
    markDone: false,
    secondary: cnt > 0,
    secondaryLabel: 'View comments',
    count: cnt,
  };
  switch (role) {
    case 'assessor':
      return {
        ...none,
        approve: !fs.approved,
        undo: fs.approved ? 'approval' : null,
        secondary: true,
        secondaryLabel: cnt > 0 ? 'View comments' : 'Add comment',
      };
    case 'lead':
      // Every commented field is the lead's to look at; they highlight the ones that need the TPB.
      return cnt > 0 ? { ...none, highlight: fs.highlighted ? 'edit' : 'mark' } : null;
    case 'tpb':
      if (!fs.highlighted) return cnt > 0 ? none : null;
      // "Required changes" carries a note for the PPU, which the TPB can edit afterwards.
      return { ...none, decide: !fs.decision, editNote: fs.decision === 'changes', undo: fs.decision ? 'decision' : null };
    case 'ppu':
      if (!(fs.highlighted && fs.decision === 'changes')) return cnt > 0 ? none : null;
      return { ...none, markDone: !fs.done, undo: fs.done ? 'done' : null };
  }
}

function cardStatus(
  d: FieldDef,
  fs: FieldState,
  readOnly: boolean,
  ai: AiVm | null,
  withDecision: boolean,
  role: ReviewRole,
): CardStatusVm {
  const cnt = fs.comments.length;
  const last = fs.comments[cnt - 1];
  if (!withDecision) {
    return { id: d.id, states: [], answeredDate: '', highlighted: false, instruction: '', ppuNote: '', ai, actions: null };
  }
  const answered = !fs.approved && !!last && last.role === 'Reporting tool';
  return {
    id: d.id,
    states: stateChips(fs),
    answeredDate: answered ? dShort(last.date) : '',
    highlighted: fs.highlighted,
    instruction: fs.highlighted ? (fs.instruction ?? '') : '',
    ppuNote: fs.highlighted && fs.decision === 'changes' ? (fs.ppuNote ?? '') : '',
    ai,
    actions: readOnly ? null : roleActions(role, fs),
  };
}

export function buildFieldVm(
  d: FieldDef,
  fs: FieldState,
  r: ReviewResult,
  readOnly: boolean,
  ai: AiVm | null,
  role: ReviewRole,
): FieldVm {
  const cnt = fs.comments.length;
  const last = fs.comments[cnt - 1];
  const hidden = d.mode === 'hidden';
  const compare = r.code === 'QA-2026-0841' && !!d.before && cnt > 0 && last.role === 'Reporting tool';
  const status = cardStatus(d, fs, readOnly, hidden ? null : ai, isAssessable(d), role);
  return {
    ...status,
    highlighted: status.highlighted && !hidden,
    label: d.label,
    tip: d.tip ?? '',
    isCore: d.mode === 'core',
    isHidden: hidden,
    isView: d.mode === 'view',
    value: fieldValue(d, r),
    before: compare ? (d.before ?? null) : null,
    scale: d.score == null ? null : IA_SCALE.map((label, n) => ({ n, label, selected: n === d.score })),
    iaGroupStart: d.id === 'iagender',
    carried: false,
    updated: false,
    leadThread: [],
    leadOwn: [],
    threadOpen: false,
  };
}

export function buildTocCardVm(d: TocDef, fs: FieldState, readOnly: boolean, ai: AiVm | null, role: ReviewRole): TocCardVm {
  const status = cardStatus(d, fs, readOnly, ai, true, role);
  if (d.mapping) {
    return {
      ...status,
      eyebrow: 'ToC mapping',
      levelChip: '',
      contrib: null,
      target: null,
      links: [
        { label: 'Contributes to the theory of change', code: '', value: 'No' },
        { label: 'Did the program invest financial resources in this result?', code: '', value: 'Yes' },
      ],
    };
  }
  return {
    ...status,
    eyebrow: 'Contribution ' + d.n,
    levelChip: d.chip ?? '',
    contrib: d.contrib ?? null,
    target: d.target ?? null,
    links: [
      { label: 'Level', code: '', value: d.level ?? '' },
      { label: 'ToC node', code: d.node?.[0] ?? '', value: d.node?.[1] ?? '' },
      { label: 'KPI statement', code: '', value: d.kpi ?? '' },
    ],
  };
}

export function groupToc(cards: readonly { def: TocDef; vm: TocCardVm }[]): TocGroupVm[] {
  if (cards.length && cards[0].def.mapping) {
    return [{ code: '', name: '', countText: '', showHead: false, items: cards.map((c) => c.vm) }];
  }
  const progs = [...new Set(cards.map((c) => c.def.prog ?? ''))];
  return progs.map((p) => {
    const items = cards.filter((c) => c.def.prog === p).map((c) => c.vm);
    return {
      code: p,
      name: TOC_PROG_NAMES[p] ?? PROGRAMS[p] ?? '',
      countText: items.length + (items.length === 1 ? ' contribution' : ' contributions'),
      showHead: progs.length > 1,
      items,
    };
  });
}

export function aiVm(match: AiMatch | undefined, open: boolean): AiVm | null {
  if (!match) return null;
  const mismatch = match.verdict === 'mm';
  return { mismatch, text: match.text, expanded: mismatch || open };
}

/** "08 Oct 2026" for new comments. */
export function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
