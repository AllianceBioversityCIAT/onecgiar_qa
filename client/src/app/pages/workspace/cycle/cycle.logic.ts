// Pure helpers and view models of the Cycle view (ported from the mockup's cyPhaseState,
// cardVM and officialRelative).
import { StepAudience } from '../../../core/api/cycles.models';
import { DEFAULT_CLOSES_TIME, DEFAULT_OPENS_TIME, nowInRome, todayInRome, zoneAt } from '../../../core/domain/rome-date';
import {
  CORRECTION_AUDIENCE,
  CycleStep,
  RESULT_TYPE_RULES,
  RT_ORDER,
  RT_SHORT,
  TODAY,
  Timeline,
} from './cycle.mock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 864e5;

/** Parses "06 Jul 2026". Returns null when the text is not a valid date. */
export function parseDate(text: string | null | undefined): Date | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*$/.exec(text ?? '');
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return mi < 0 ? null : new Date(+m[3], mi, +m[1]);
}

export function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "06 Jul 2026" → "06 Jul". */
export function shortDate(text: string): string {
  return (text || '').replace(/\s+\d{4}\s*$/, '');
}

/** "06 Jul 2026" → "2026-07-06" ('' when unreadable), for the Rome zone of a day. */
function isoDay(text: string): string {
  const d = parseDate(text);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

const opensTimeOf = (p: Pick<CycleStep, 'startTime'>) => p.startTime || DEFAULT_OPENS_TIME;
const closesTimeOf = (p: Pick<CycleStep, 'endTime'>) => p.endTime || DEFAULT_CLOSES_TIME;

/**
 * The two lines of a step card, opening then closing minute (Rome): "12 Nov, 09:00 –" / "20 Nov, 17:30 CET"
 * ("12:00 CET" when it closes the same day). The zone shows on both ends only when a clock change sits in between.
 */
function cardLines(p: CycleStep): { from: string; to: string } {
  const [st, et] = [opensTimeOf(p), closesTimeOf(p)];
  const zs = zoneAt(isoDay(p.start), st);
  if (!p.end) return { from: `${shortDate(p.start)}, ${st} ${zs}`, to: '' };
  const ze = zoneAt(isoDay(p.end), et);
  return {
    from: `${shortDate(p.start)}, ${st}${zs === ze ? '' : ` ${zs}`} –`,
    to: p.end === p.start ? `${et} ${ze}` : `${shortDate(p.end)}, ${et} ${ze}`,
  };
}

export function formatNumber(n: number): string {
  return Number(n).toLocaleString('en-US');
}

export type StepState =
  | { kind: 'done'; text: string }
  | { kind: 'active'; pct: number; done: number; of: number }
  | { kind: 'future'; days: number };

/** Whole days from today in Rome to a "06 Jul 2026" day (0 when unreadable). */
export function daysFromToday(text: string, today: string = todayInRome()): number {
  const d = parseDate(text);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!d || !m) return 0;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / DAY);
}

export function stepState(p: CycleStep, t: Timeline): StepState {
  let st: StepState;
  if (p.state === 'closed') st = { kind: 'done', text: '' };
  else if (p.state === 'in_progress') st = { kind: 'active', pct: 0, done: 0, of: t.results };
  else if (p.state === 'upcoming') st = { kind: 'future', days: Math.max(0, daysFromToday(p.start)) };
  else if (p.done) st = { kind: 'done', text: p.done };
  else if (p.active) st = { kind: 'active', ...p.active };
  else {
    const s0 = parseDate(p.start);
    const e0 = parseDate(p.end) ?? s0;
    if (!s0 || !e0) st = { kind: 'future', days: 0 };
    else if (e0 < TODAY) st = { kind: 'done', text: 'No results assessed' };
    else if (s0 <= TODAY) st = { kind: 'active', pct: 0, done: 0, of: t.results };
    else st = { kind: 'future', days: Math.round((s0.getTime() - TODAY.getTime()) / DAY) };
  }
  if (t.status === 'Closed' && st.kind !== 'done') {
    st = { kind: 'done', text: st.kind === 'active' ? `${formatNumber(st.done)} of ${formatNumber(st.of)} reviewed` : 'Not opened' };
  }
  return st;
}

/** For each step: true when it opens before the previous step closes. */
export function stepOrderErrors(steps: readonly { start: string; end: string }[]): boolean[] {
  return steps.map((p, i) => {
    if (!i) return false;
    const s0 = parseDate(p.start);
    const prev = parseDate(steps[i - 1].end) ?? parseDate(steps[i - 1].start);
    return !!(s0 && prev && s0 <= prev);
  });
}

export interface StepDraftRow {
  name: string;
  start: string;
  end: string;
  /** Rome `HH:mm`, 24-hour, as typed (`parseTime` reads it). */
  startTime: string;
  endTime: string;
  batch: boolean;
  /** Who works in the step on the server; a row keeps it when others are dropped. */
  audience?: StepAudience;
}

/** A saved step as an editable row (missing times = the server defaults). */
export function stepRow(p: CycleStep): StepDraftRow {
  return { name: p.name, start: p.start, end: p.end, startTime: opensTimeOf(p), endTime: closesTimeOf(p), batch: p.batch, audience: p.audienceKey };
}

/**
 * Timelines that can take a sync now (contract timeline-sync § 2, FR-1): saved on the server, at any step,
 * until the closing minute of the LAST step (Rome; that minute is still open). The cycle being closed and
 * a load already running are checked by the view (`canLoad`). The server has the last word (`window` of
 * the preview, 409 `LOADS_WINDOW_CLOSED`).
 */
export function loadTargets(timelines: readonly Timeline[], now: string): Timeline[] {
  return timelines.filter((t) => {
    const last = t.steps[t.steps.length - 1];
    if (t.apiId == null || !last || last.state === 'closed') return false;
    const day = isoDay(last.end || last.start);
    return !day || `${day}T${closesTimeOf(last)}` >= now;
  });
}

/**
 * Index of the step a sync started now goes into (contract timeline-sync § 2): the last step whose opening
 * minute has passed, or step 1 before any opens; the gap after a step closes still belongs to it. The
 * front's guess for labels only: the preview's `round` / `stepPosition` are the server's answer.
 */
export function stepInForce(t: Pick<Timeline, 'steps'>, now: string): number {
  let at = 0;
  t.steps.forEach((p, i) => {
    const opens = opensMoment(p);
    if (opens != null && opens <= now) at = i;
  });
  return at;
}

/** The step drawer offers the sync only on an existing step (`index` null = "Add step") that is the one in force. */
export function isStepInForce(t: Pick<Timeline, 'steps'>, index: number | null, now: string): boolean {
  return index != null && index === stepInForce(t, now);
}

/** QA round of a step: the stored one (API), else counted from the "Loads results" switches (mock). */
export function stepRound(t: Pick<Timeline, 'steps'>, index: number): number {
  return t.steps[index]?.round ?? t.steps.slice(1, index + 1).filter((p) => p.batch).length + 1;
}

/** Opening minute of a step as `YYYY-MM-DDTHH:mm` in Rome (null when its day is unreadable), comparable with `nowInRome()`. */
function opensMoment(p: Pick<CycleStep, 'start' | 'startTime'>): string | null {
  const day = isoDay(p.start);
  return day ? `${day}T${opensTimeOf(p)}` : null;
}

/**
 * First day step 1 can open on at its own opening minute: today in Rome, or tomorrow when that minute already
 * went by today (a new timeline's step 1 cannot open before now).
 */
function firstOpenDay(first: Pick<CycleStep, 'startTime'> | undefined, now: string): Date {
  const [day, time] = now.split('T');
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + (first && opensTimeOf(first) < time ? 1 : 0));
}

/**
 * "Reset to main batch": the official steps, shifted to start on `startText`, each keeping its hour and minute.
 * With no day typed in step 1 yet, they start on the first day step 1 can open (never on a fixed past date).
 */
export function officialRelative(startText: string, official: Timeline): StepDraftRow[] {
  const o0 = parseDate(official.steps[0]?.start);
  const base = parseDate(startText) ?? firstOpenDay(official.steps[0], nowInRome());
  // Whole days, never milliseconds: a summer-time change in between would land on 23:00 of the day before.
  const at = (d: Date | null) => {
    if (!d || !o0) return '';
    const days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(o0.getFullYear(), o0.getMonth(), o0.getDate())) / DAY);
    return formatDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
  };
  return official.steps.map((p) => ({ ...stepRow(p), start: at(parseDate(p.start)), end: at(parseDate(p.end)) }));
}

/**
 * ["12 Nov, 09:00 –", "20 Nov 2026, 17:30 CET"]: first opening to last closing minute, Rome time (zone on
 * both ends across a clock change). Two parts so a narrow screen breaks the line at the dash.
 */
function rangeParts(first: CycleStep, last: CycleStep): [string, string] {
  const endDay = last.end || last.start;
  const endTime = last.end ? closesTimeOf(last) : opensTimeOf(last);
  const zs = zoneAt(isoDay(first.start), opensTimeOf(first));
  const ze = zoneAt(isoDay(endDay), endTime);
  return [`${shortDate(first.start)}, ${opensTimeOf(first)}${zs === ze ? '' : ` ${zs}`} –`, `${endDay}, ${endTime} ${ze}`];
}

/** Start time of a timeline, for sorting (newest first). */
export function timelineStart(t: Timeline): number {
  return parseDate(t.steps[0]?.start)?.getTime() ?? 0;
}

// ---------------------------------------------------------------------------------------------
// View models for the presentational components.

export type MenuAction = 'add-results' | 'edit' | 'export' | 'clear-test' | 'close';

export interface StepCardVM {
  n: number;
  name: string;
  /** Opening minute line, e.g. "12 Nov, 09:00 –". */
  from: string;
  /** Closing minute line with its zone, e.g. "20 Nov, 17:30 CET" ('' without a closing date). */
  to: string;
  /** Opening minute, for "Opens today at 09:00". */
  opensTime: string;
  hasBatch: boolean;
  joinText: string;
  joinTitle: string;
  syncText: string;
  state: StepState['kind'];
  doneText: string;
  pct: number;
  reviewed: string;
  of: string;
  days: number;
  dayWord: string;
  /** Progress numbers exist (mock data; the API has no loads yet). Without them the card says until when it is open. */
  hasProgress: boolean;
  /**
   * The timeline is on hold: step 1's day came and nothing is loaded yet (`waiting_for_load`), so the server
   * sends every step as `upcoming`. Step 1 and every step whose opening minute already went by show
   * "Waiting for results", never "Opens today at 00:00" (timeline-edit front contract § 3).
   */
  waiting: boolean;
}

export interface TimelineVM {
  id: string;
  name: string;
  kind: string;
  /** What the screen calls the kind: "Main batch" / "Complementary batch" (María Julia, 2026-10-27); `kind` stays for the logic. */
  kindLabel: string;
  status: string;
  statusClass: string;
  isTest: boolean;
  closed: boolean;
  range: string;
  /** `range` split at the dash (each part kept on one line). */
  rangeParts: [string, string];
  results: string;
  stepCount: number;
  canEdit: boolean;
  progText: string;
  typeText: string;
  steps: StepCardVM[];
  rail: StepState['kind'][];
  rounds: { label: string; span: number; on: boolean }[];
  /** CSS width of the primary rail fill, or null when nothing runs. */
  progressWidth: string | null;
  /** `soon`: shown greyed out with "Coming soon" (no API yet). */
  menu: { action: MenuAction; label: string; danger: boolean; soon: boolean }[];
}

const STATUS_CLASS: Record<string, string> = {
  Live: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Scheduled: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  'Waiting for results': 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  Closed: 'bg-(--surface-3) text-(--text-muted)',
};

/**
 * Live data has no export, test or close endpoint yet: those actions show as "Coming soon".
 * `loadable`: the timeline can take a sync now (`loadTargets`) and no load runs; the menu names the round in force.
 */
export function timelineVM(t: Timeline, loadable = false): TimelineVM {
  const soon = t.apiId != null;
  const n = t.steps.length;
  const closed = t.status === 'Closed';
  const states = t.steps.map((p) => stepState(p, t));
  const held = t.status === 'Waiting for results';
  const now = held ? nowInRome() : '';
  const steps: StepCardVM[] = t.steps.map((p, i) => {
    const st = states[i];
    const opens = opensMoment(p);
    const joinTypes =
      i > 0 && p.batch
        ? RT_ORDER.filter((rt) => RESULT_TYPE_RULES[rt]?.phase === i + 1 && (!t.types.length || t.types.includes(rt)))
        : [];
    const firstJoin = joinTypes[0] ? (RT_SHORT[joinTypes[0]] ?? joinTypes[0]) : '';
    const corr = p.audience === CORRECTION_AUDIENCE;
    const sync = corr && (st.kind === 'active' || (st.kind === 'done' && st.text !== 'Not opened'));
    return {
      n: i + 1,
      name: p.name,
      ...cardLines(p),
      opensTime: opensTimeOf(p),
      hasBatch: p.batch,
      joinText: joinTypes.length ? `${firstJoin}${joinTypes.length > 1 ? ` +${joinTypes.length - 1}` : ''} join here` : '',
      joinTitle: joinTypes.join(', '),
      syncText: !sync ? '' : st.kind === 'active' ? 'Last synced 2 hours ago' : `Synced until ${shortDate(p.end || p.start)}`,
      state: st.kind,
      doneText: st.kind === 'done' ? st.text : '',
      pct: st.kind === 'active' ? st.pct : 0,
      reviewed: st.kind === 'active' ? formatNumber(st.done) : '',
      of: st.kind === 'active' ? formatNumber(st.of) : '',
      days: st.kind === 'future' ? st.days : 0,
      dayWord: st.kind === 'future' && st.days === 1 ? 'day' : 'days',
      hasProgress: st.kind === 'active' && st.of > 0,
      waiting: held && (i === 0 || (opens != null && opens <= now)),
    };
  });
  const rail = states.map((s) => (closed ? 'done' : s.kind));
  const ai = rail.indexOf('active');
  const pct = ai >= 0 && states[ai].kind === 'active' ? (states[ai] as { pct: number }).pct : 0;
  const cell = `((100% - ${12 * (n - 1)}px) / ${Math.max(1, n)})`;
  const f = ai >= 0 && ai < n - 1 ? pct / 100 : 0;
  const progressWidth = !closed && ai >= 0 ? `calc(${ai} * ${cell} + ${12 * ai}px + ${f} * (${cell} + 12px))` : null;

  const rounds: { label: string; span: number; on: boolean }[] = [];
  let start = 0;
  t.steps.forEach((p, i) => {
    if (i === 0 || p.batch) {
      rounds.push({ label: `QA round ${rounds.length + 1}`, span: 1, on: false });
      start = i;
    } else rounds[rounds.length - 1].span++;
    const r = rounds[rounds.length - 1];
    r.on = !closed && ai >= start && ai < start + r.span;
  });

  const menu: TimelineVM['menu'] = [];
  if (loadable) {
    const round = stepRound(t, stepInForce(t, nowInRome()));
    menu.push({ action: 'add-results', label: `Load results into QA round ${round}`, danger: false, soon: false });
  }
  else if (!soon && t.status === 'Live') menu.push({ action: 'add-results', label: 'Add results to this timeline', danger: false, soon: false });
  menu.push({ action: 'edit', label: 'Edit timeline', danger: false, soon: false }, { action: 'export', label: 'Export comments', danger: false, soon });
  if (t.test) menu.push({ action: 'clear-test', label: 'Clear test results', danger: true, soon });
  if (t.kind !== 'Official timeline' && t.kind !== 'Official' && !closed) menu.push({ action: 'close', label: 'Close timeline', danger: true, soon });

  const first = t.steps[0];
  const last = t.steps[n - 1];
  const rangeLine: [string, string] = first ? rangeParts(first, last) : ['—', ''];
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    kindLabel: t.kind === 'Sub-timeline' ? 'Complementary batch' : 'Main batch',
    status: t.status,
    statusClass: STATUS_CLASS[t.status] ?? STATUS_CLASS['Live'],
    isTest: !!t.test,
    closed,
    range: rangeLine.join(' '),
    rangeParts: rangeLine,
    results: formatNumber(t.results),
    stepCount: n,
    canEdit: !closed,
    progText: t.programs.length ? t.programs.join(', ') : 'All programs',
    typeText: t.types.length ? t.types.join(', ') : 'All result types',
    steps,
    rail,
    rounds,
    progressWidth,
    menu,
  };
}
