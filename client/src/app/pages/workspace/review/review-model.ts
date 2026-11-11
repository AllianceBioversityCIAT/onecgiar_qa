// View models and pure helpers for the Review page. One page for every reviewing role; only the buttons change.
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
  /** Third-party broker: "Agreed with program" / "Required changes". */
  readonly decide: boolean;
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
 * Assessor: approved, the last word in the thread is the assessor's comment, or the program rejected the comment
 * (that goes to the lead assessor, not back to the assessor). ToC needs approval.
 */
export function isResolved(d: FieldDef, fs: FieldState): boolean {
  if (d.sec === 'toc') return fs.approved || programRejected(fs);
  const last = fs.comments[fs.comments.length - 1];
  return fs.approved || (!!last && last.role === 'Assessor') || programRejected(fs);
}

/** The program rejected the assessor's comment (its last answer in the thread). */
export function programRejected(fs: FieldState): boolean {
  const answers = fs.comments.filter((c) => c.role === 'Program');
  return answers[answers.length - 1]?.reply === 'rejected';
}

/**
 * Fields a role works on, and whether each one still needs it.
 * Lead assessor: the comments the program rejected (marking one as highlight is what the lead does with it).
 * TPB: highlighted fields, until decided. PPU: "Required changes", until done.
 */
export function roleScope(role: ReviewRole, d: FieldDef, fs: FieldState): { readonly mine: boolean; readonly open: boolean } {
  switch (role) {
    case 'assessor':
      return { mine: true, open: !isResolved(d, fs) };
    case 'lead': {
      const mine = programRejected(fs);
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
      // Any commented field can be highlighted; the rejected ones are the lead's queue.
      return cnt > 0 ? { ...none, highlight: fs.highlighted ? 'edit' : 'mark' } : null;
    case 'tpb':
      if (!fs.highlighted) return cnt > 0 ? none : null;
      return { ...none, decide: !fs.decision, undo: fs.decision ? 'decision' : null };
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
    return { id: d.id, states: [], answeredDate: '', highlighted: false, instruction: '', ai, actions: null };
  }
  const answered = !fs.approved && !!last && last.role === 'Reporting tool';
  return {
    id: d.id,
    states: stateChips(fs),
    answeredDate: answered ? dShort(last.date) : '',
    highlighted: fs.highlighted,
    instruction: fs.highlighted ? (fs.instruction ?? '') : '',
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
