// Pure helpers for the Overview view (date math, estimates). Ported from the mockup JS.
import {
  AUTO_APPROVED,
  LOAD_ALREADY_IN_QA,
  LOAD_SUBMITTED,
  LOAD_TARGETS,
  MOCK_TODAY,
  OFFICIAL_RESULTS,
  PHASE_NAMES,
  PROGRAMS,
  RESULT_TYPES,
  RESULT_TYPE_ORDER,
  RESULT_TYPE_PLURAL,
  RESULT_TYPE_RULES,
  Timeline,
  TimelinePhase,
} from './overview.mock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 864e5;
const TYPE_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(RESULT_TYPES);

/** 1330 → "1,330". */
export const fmt = (n: number): string => Number(n).toLocaleString('en-US');

/** "06 May 2026" → Date (null if it does not parse). */
export function parseDate(str: string): Date | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*$/.exec(str || '');
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return mi < 0 ? null : new Date(+m[3], mi, +m[1]);
}

/** "06 May 2026" → "06 May". */
export const shortDate = (str: string): string => (str || '').replace(/\s+\d{4}\s*$/, '');

export type PhaseState =
  | { readonly kind: 'done' }
  | { readonly kind: 'active'; readonly pct: number; readonly done: number; readonly of: number }
  | { readonly kind: 'future' };

export function phaseState(p: TimelinePhase, b: Timeline): PhaseState {
  let st: PhaseState;
  if (p.done) st = { kind: 'done' };
  else if (p.active) st = { kind: 'active', ...p.active };
  else {
    const s0 = parseDate(p.start);
    const e0 = parseDate(p.end) ?? s0;
    if (!s0 || !e0) st = { kind: 'future' };
    else if (e0 < MOCK_TODAY) st = { kind: 'done' };
    else if (s0 <= MOCK_TODAY) st = { kind: 'active', pct: 0, done: 0, of: b.results };
    else st = { kind: 'future' };
  }
  return b.status === 'Closed' ? { kind: 'done' } : st;
}

export interface TimelineInfo {
  /** Step shown for the timeline: the open one, else the next one, else the last one. */
  readonly phase: TimelinePhase;
  readonly state: PhaseState;
  readonly step: number;
  readonly steps: number;
  readonly when: 'closes' | 'opens' | 'closed';
  readonly date: string;
}

export function timelineInfo(b: Timeline): TimelineInfo {
  const steps = b.phases.length;
  const states = b.phases.map((p) => phaseState(p, b));
  const ai = states.findIndex((s) => s.kind === 'active');
  if (ai >= 0) {
    const p = b.phases[ai];
    return { phase: p, state: states[ai], step: ai + 1, steps, when: 'closes', date: shortDate(p.end || p.start) };
  }
  const fi = states.findIndex((s) => s.kind === 'future');
  if (fi >= 0) {
    const p = b.phases[fi];
    return { phase: p, state: states[fi], step: fi + 1, steps, when: 'opens', date: shortDate(p.start) };
  }
  const last = b.phases[steps - 1];
  return { phase: last, state: states[steps - 1], step: steps, steps, when: 'closed', date: shortDate(last.end || last.start) };
}

/** Whole days from the mockup's "today" to a date string (negative when past). */
export function daysFromToday(str: string): number {
  const d = parseDate(str);
  return d ? Math.round((d.getTime() - MOCK_TODAY.getTime()) / DAY_MS) : 0;
}

// ---------- Load results into QA ----------

export interface LoadEstimate {
  readonly matched: number;
  readonly already: number;
  readonly pulled: number;
  readonly notFirst: boolean;
  readonly joins: readonly { readonly n: string; readonly what: string; readonly phase: string }[];
  readonly autos: readonly { readonly n: string; readonly what: string }[];
}

export function loadEstimate(target: string, types: readonly string[], programs: readonly string[]): LoadEstimate {
  const tf = types.length ? types.reduce((a, t) => a + (TYPE_COUNTS[t] || 0), 0) / OFFICIAL_RESULTS : 1;
  const pf = programs.length ? programs.length / Object.keys(PROGRAMS).length : 1;
  const matched = Math.round(LOAD_SUBMITTED * tf * pf);
  const already = Math.round((matched * LOAD_ALREADY_IN_QA) / LOAD_SUBMITTED);
  const tgt = LOAD_TARGETS.find((t) => t.id === target);
  const targetPhase = (+(target.split(':')[1] ?? 0) || 0) + 1;
  const selected = RESULT_TYPE_ORDER.filter((t) => !types.length || types.includes(t));
  return {
    matched,
    already,
    pulled: matched - already,
    notFirst: !!tgt && !tgt.first,
    joins: selected
      .filter((t) => RESULT_TYPE_RULES[t].phase !== targetPhase)
      .map((t) => ({ n: fmt(TYPE_COUNTS[t] || 0), what: RESULT_TYPE_PLURAL[t], phase: PHASE_NAMES[RESULT_TYPE_RULES[t].phase - 1] })),
    autos: selected
      .filter((t) => RESULT_TYPE_RULES[t].auto)
      .map((t) => ({ n: fmt(AUTO_APPROVED[t] ?? Math.round((TYPE_COUNTS[t] || 0) / 4)), what: RESULT_TYPE_PLURAL[t] })),
  };
}
