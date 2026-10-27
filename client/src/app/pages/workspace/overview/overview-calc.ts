// Pure helpers for the Overview view (date math, number formatting). Ported from the mockup JS.
import { MOCK_TODAY, Timeline, TimelinePhase } from './overview.mock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 864e5;

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
