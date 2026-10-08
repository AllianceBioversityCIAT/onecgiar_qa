// Pure helpers and view models of the Cycle view (ported from the mockup's cyPhaseState,
// cardVM, runEstimate, officialRelative and runTargets).
import {
  CORRECTION_AUDIENCE,
  CycleStep,
  PROGRAMS,
  RESULT_TYPES,
  RESULT_TYPE_RULES,
  RT_AUTO_N,
  RT_ORDER,
  RT_PLURAL,
  RT_SHORT,
  RUN_TARGETS,
  RunTarget,
  TODAY,
  TOTAL_RESULTS,
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

export function formatNumber(n: number): string {
  return Number(n).toLocaleString('en-US');
}

export type StepState =
  | { kind: 'done'; text: string }
  | { kind: 'active'; pct: number; done: number; of: number }
  | { kind: 'future'; days: number };

export function stepState(p: CycleStep, t: Timeline): StepState {
  let st: StepState;
  if (p.done) st = { kind: 'done', text: p.done };
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
    return !!(s0 && prev && s0 < prev);
  });
}

export interface RunEstimate {
  matched: number;
  already: number;
  pulled: number;
}

export function runEstimate(types: readonly string[], programs: readonly string[]): RunEstimate {
  const typeCounts = Object.fromEntries(RESULT_TYPES);
  const tf = types.length ? types.reduce((a, t) => a + (typeCounts[t] ?? 0), 0) / TOTAL_RESULTS : 1;
  const pf = programs.length ? programs.length / Object.keys(PROGRAMS).length : 1;
  const matched = Math.round(1200 * tf * pf);
  const already = Math.round((matched * 86) / 1200);
  return { matched, already, pulled: matched - already };
}

export interface LoadSummary extends RunEstimate {
  notFirst: boolean;
  joins: { n: string; what: string; step: string }[];
  autos: { n: string; what: string }[];
}

/** Text of the live estimate in the "Load results" drawers. */
export function loadSummary(
  types: readonly string[],
  programs: readonly string[],
  target: string | null,
  targets: readonly RunTarget[],
  official: Timeline,
): LoadSummary {
  const est = runEstimate(types, programs);
  const tgt = targets.find((t) => t.id === target);
  const tStep = target ? (+target.split(':')[1] || 0) + 1 : 1;
  const typeCounts: Record<string, number> = Object.fromEntries(RESULT_TYPES);
  const sel = RT_ORDER.filter((t) => !types.length || types.includes(t));
  const joins = sel
    .filter((t) => RESULT_TYPE_RULES[t] && RESULT_TYPE_RULES[t].phase !== tStep)
    .map((t) => ({
      n: formatNumber(typeCounts[t] ?? 0),
      what: RT_PLURAL[t] ?? t,
      step: official.steps[RESULT_TYPE_RULES[t].phase - 1]?.name ?? '',
    }));
  const autos = sel
    .filter((t) => RESULT_TYPE_RULES[t]?.auto)
    .map((t) => ({ n: formatNumber(RT_AUTO_N[t] ?? Math.round((typeCounts[t] ?? 0) / 4)), what: RT_PLURAL[t] ?? t }));
  return { ...est, notFirst: !!tgt && !tgt.first, joins, autos };
}

/** Target step options; adds the requested step on top when it is not a default target. */
export function runTargets(key: string | null, timelines: readonly Timeline[]): RunTarget[] {
  const list = RUN_TARGETS.slice();
  if (key && !list.some((t) => t.id === key)) {
    const [bid, si] = key.split(':');
    const i = +si;
    const b = timelines.find((x) => x.id === bid);
    const p = b?.steps[i];
    if (b && p) {
      const st = stepState(p, b);
      list.unshift({
        id: key,
        label: `${b.name} · ${p.name}`,
        desc:
          st.kind === 'active'
            ? `Open · closes ${shortDate(p.end || p.start)}`
            : st.kind === 'future'
              ? `Opens ${shortDate(p.start)}`
              : `Closed on ${shortDate(p.end || p.start)}`,
        first: i === 0,
      });
    }
  }
  return list;
}

export interface StepDraftRow {
  name: string;
  start: string;
  end: string;
  batch: boolean;
}

/** "Reset to official timeline": the official steps, shifted to start on `startText`. */
export function officialRelative(startText: string, official: Timeline): StepDraftRow[] {
  const o0 = parseDate(official.steps[0]?.start);
  const base = parseDate(startText) ?? new Date(2026, 8, 1);
  const at = (d: Date | null) => (d && o0 ? formatDate(new Date(base.getTime() + (d.getTime() - o0.getTime()))) : '');
  return official.steps.map((p) => ({ name: p.name, start: at(parseDate(p.start)), end: at(parseDate(p.end)), batch: p.batch }));
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
  dates: string;
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
}

export interface TimelineVM {
  id: string;
  name: string;
  kind: string;
  status: string;
  statusClass: string;
  isTest: boolean;
  closed: boolean;
  range: string;
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
  menu: { action: MenuAction; label: string; danger: boolean }[];
}

const STATUS_CLASS: Record<string, string> = {
  Live: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Scheduled: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  Closed: 'bg-(--surface-3) text-(--text-muted)',
};

export function timelineVM(t: Timeline, readOnly: boolean): TimelineVM {
  const n = t.steps.length;
  const closed = t.status === 'Closed';
  const states = t.steps.map((p) => stepState(p, t));
  const steps: StepCardVM[] = t.steps.map((p, i) => {
    const st = states[i];
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
      dates: p.end ? `${shortDate(p.start)} – ${shortDate(p.end)}` : shortDate(p.start),
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
  if (t.status === 'Live') menu.push({ action: 'add-results', label: 'Add results to this timeline', danger: false });
  menu.push({ action: 'edit', label: 'Edit timeline', danger: false }, { action: 'export', label: 'Export comments', danger: false });
  if (t.test) menu.push({ action: 'clear-test', label: 'Clear test results', danger: true });
  if (t.kind !== 'Official timeline' && t.kind !== 'Official' && !closed) menu.push({ action: 'close', label: 'Close timeline', danger: true });

  const first = t.steps[0];
  const last = t.steps[n - 1];
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    status: t.status,
    statusClass: STATUS_CLASS[t.status] ?? STATUS_CLASS['Live'],
    isTest: !!t.test,
    closed,
    range: first ? `${shortDate(first.start)} – ${last.end || last.start}` : '—',
    results: formatNumber(t.results),
    stepCount: n,
    canEdit: !readOnly && !closed,
    progText: t.programs.length ? t.programs.join(', ') : 'All programs',
    typeText: t.types.length ? t.types.join(', ') : 'All result types',
    steps,
    rail,
    rounds,
    progressWidth,
    menu,
  };
}
