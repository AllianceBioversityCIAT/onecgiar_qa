// Translation between the cycles/timelines API (`core/api/cycles.models`) and the Cycle view model
// (`cycle.mock` types, kept so the design components stay as they are). Pure functions, no state.
//
// API steps open and close at Rome minutes `YYYY-MM-DDTHH:mm`; the view shows and edits the day as
// "06 Jul 2026" and the time as `HH:mm` (24-hour). They are converted here as plain text and numbers,
// never through the viewer's time zone.
import {
  STEP_AUDIENCES,
  StepAudience,
  Timeline as ApiTimeline,
  TimelineCreate,
  TimelineStatus as ApiStatus,
  TimelineStepInput,
  TimelineStepUpdate,
  TimelineUpdate,
} from '../../../core/api/cycles.models';
import { ResultTypeOption, ScienceProgramOption } from '../../../core/api/users.models';
import {
  DEFAULT_CLOSES_TIME,
  DEFAULT_OPENS_TIME,
  formatDay,
  formatMoment,
  isDstHour,
  parseDay,
  parseTime,
  splitMoment,
} from '../../../core/domain/rome-date';
import { StepDraftRow } from './cycle.logic';
import { AUDIENCES, CORRECTION_AUDIENCE, CycleStep, Timeline, TimelineStatus } from './cycle.mock';

/** The official timeline keeps this view id (the drawers branch on it); its API id is `apiId`. */
export const OFFICIAL_ID = 'official';

export interface CycleCatalogs {
  readonly programs: readonly ScienceProgramOption[];
  readonly types: readonly ResultTypeOption[];
}

/** API audience ↔ the label the view shows (same order as STEP_AUDIENCES). */
const AUDIENCE_LABEL: Readonly<Record<StepAudience, string>> = {
  assessors: AUDIENCES[0],
  programs: CORRECTION_AUDIENCE,
  lead_assessors: AUDIENCES[2],
  tpb: AUDIENCES[3],
  ppu: AUDIENCES[4],
};

const STATUS: Readonly<Record<ApiStatus, TimelineStatus>> = {
  scheduled: 'Scheduled',
  waiting_for_load: 'Waiting for results',
  live: 'Live',
  finished: 'Closed',
};

export function audienceLabel(audience: StepAudience): string {
  return AUDIENCE_LABEL[audience] ?? audience;
}

/** `2026-07-06` → `06 Jul 2026`. */
export function toViewDay(day: string): string {
  return formatDay(day);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * `06 Jul 2026` → `2026-07-06`; empty, unreadable or impossible text (`31 Feb`) gives '' so the
 * server answers REQUIRED/INVALID instead of a silently rolled-over day.
 */
export function toApiDay(text: string): string {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*$/.exec(text ?? '');
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) + 1 : 0;
  if (!m || !month) return '';
  const day = `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return parseDay(day) ? day : '';
}

/** Day `06 Jul 2026` + time `9:30` → `2026-07-06T09:30`; '' when either is unreadable (the server then answers REQUIRED). */
export function toApiMoment(day: string, time: string): string {
  const d = toApiDay(day);
  const t = parseTime(time);
  return d && t ? `${d}T${t}` : '';
}

/** A step's moment, or (deprecated keys only) its day at the server default time. */
function readMoment(moment: string | undefined, day: string | undefined, defaultTime: string): { day: string; time: string } {
  return splitMoment(moment) ?? { day: day ?? '', time: defaultTime };
}

export function toViewTimeline(t: ApiTimeline, cat: CycleCatalogs): Timeline {
  const official = t.kind === 'official';
  const codes = t.programIds.map((id) => cat.programs.find((p) => p.id === id)?.code ?? `#${id}`);
  const types = t.resultTypeKeys.map((k) => cat.types.find((x) => x.key === k)?.name ?? k);
  return {
    id: official ? OFFICIAL_ID : String(t.id),
    apiId: t.id,
    version: t.version,
    name: t.name,
    kind: official ? 'Official' : 'Sub-timeline',
    status: STATUS[t.status] ?? 'Scheduled',
    // Loads are not built yet (P2-3905): no timeline holds results.
    results: 0,
    programs: t.allPrograms ? [] : codes,
    types: t.allResultTypes ? [] : types,
    steps: [...t.steps]
      .sort((a, b) => a.position - b.position)
      .map((s): CycleStep => {
        const opens = readMoment(s.opensAt, s.opensOn, DEFAULT_OPENS_TIME);
        const closes = readMoment(s.closesAt, s.closesOn, DEFAULT_CLOSES_TIME);
        return {
          name: s.name,
          audience: audienceLabel(s.audience),
          audienceKey: s.audience,
          start: toViewDay(opens.day),
          end: toViewDay(closes.day),
          startTime: opens.time,
          endTime: closes.time,
          batch: s.requiresLoad,
          ran: '',
          state: s.state,
          round: s.round,
        };
      }),
  };
}

/** Next audience after the ones already used, in workflow order (a new row takes it). */
export function nextAudience(used: readonly StepAudience[]): StepAudience | null {
  const last = used.length ? STEP_AUDIENCES.indexOf(used[used.length - 1]) : -1;
  return STEP_AUDIENCES[last + 1] ?? null;
}

/** Rounds as the server checks them: 1 on step 1, +1 on every later step that loads results. */
export function roundsOf(rows: readonly Pick<StepDraftRow, 'batch'>[]): number[] {
  let round = 1;
  return rows.map((r, i) => (i > 0 && r.batch ? ++round : round));
}

export interface CreateDraft {
  readonly name: string;
  /** Program codes; empty = all programs (only allowed for the official timeline). */
  readonly programs: readonly string[];
  /** Result type names; empty = all result types. */
  readonly types: readonly string[];
  readonly steps: readonly StepDraftRow[];
}

/** The create body: explicit scope flags, audiences in workflow order, rounds from the load switches. */
export function toCreateBody(d: CreateDraft, cat: CycleCatalogs): TimelineCreate {
  const rounds = roundsOf(d.steps);
  const audiences: StepAudience[] = [];
  const steps = d.steps.map((r, i): TimelineStepInput => {
    const audience = r.audience ?? nextAudience(audiences) ?? 'ppu';
    audiences.push(audience);
    return {
      name: r.name.trim(),
      audience,
      opensAt: toApiMoment(r.start, r.startTime),
      closesAt: toApiMoment(r.end, r.endTime),
      round: rounds[i],
      requiresLoad: r.batch,
    };
  });
  return {
    name: d.name.trim(),
    allPrograms: !d.programs.length,
    ...(d.programs.length ? { programIds: d.programs.map((c) => cat.programs.find((p) => p.code === c)?.id ?? -1) } : {}),
    allResultTypes: !d.types.length,
    ...(d.types.length ? { resultTypeKeys: d.types.map((n) => cat.types.find((t) => t.name === n)?.key ?? n) } : {}),
    steps,
  };
}

const sameSet = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Same minute whatever the typing (`9` = `09:00`). */
const sameTime = (typed: string, stored: string) => (parseTime(typed) ?? typed.trim()) === stored;

/**
 * The edit body: `version` plus only what changed. A scope change sends its flag and its list
 * together; a step is sent by position with only its changed keys: a boundary whose day or time moved
 * goes as a Rome moment, an untouched one is left out (resending it would rewrite the stored minute).
 * Null when nothing changed.
 */
export function toUpdateBody(before: Timeline, d: CreateDraft, cat: CycleCatalogs): TimelineUpdate | null {
  const body: { -readonly [K in keyof TimelineUpdate]: TimelineUpdate[K] } = { version: before.version ?? 0 };
  if (before.id !== OFFICIAL_ID && d.name.trim() !== before.name) body.name = d.name.trim();
  if (!sameSet(d.programs, before.programs)) {
    body.allPrograms = !d.programs.length;
    body.programIds = d.programs.map((c) => cat.programs.find((p) => p.code === c)?.id ?? -1);
  }
  if (!sameSet(d.types, before.types)) {
    body.allResultTypes = !d.types.length;
    body.resultTypeKeys = d.types.map((n) => cat.types.find((t) => t.name === n)?.key ?? n);
  }
  const steps = d.steps.flatMap((r, i): TimelineStepUpdate[] => {
    const old = before.steps[i];
    if (!old) return [];
    const change: { -readonly [K in keyof TimelineStepUpdate]: TimelineStepUpdate[K] } = { position: i + 1 };
    if (r.name.trim() !== old.name) change.name = r.name.trim();
    if (r.start.trim() !== old.start || !sameTime(r.startTime, old.startTime || DEFAULT_OPENS_TIME)) change.opensAt = toApiMoment(r.start, r.startTime);
    if (r.end.trim() !== old.end || !sameTime(r.endTime, old.endTime || DEFAULT_CLOSES_TIME)) change.closesAt = toApiMoment(r.end, r.endTime);
    return Object.keys(change).length > 1 ? [change] : [];
  });
  if (steps.length) body.steps = steps;
  return Object.keys(body).length > 1 ? body : null;
}

export interface StepDateIssue {
  readonly start?: string;
  readonly end?: string;
}

/** Problem of one boundary as typed (day, then time, then the clock-change hour), naming the field, or undefined. */
function boundaryIssue(day: string, time: string, which: 'opening' | 'closing'): string | undefined {
  const d = toApiDay(day);
  const t = parseTime(time);
  if (day.trim() && !d) return `Not a real ${which} date. Use the format 06 Jul 2026.`;
  if (time.trim() && !t) return `Not a real ${which} time. Use the 24-hour clock, for example 14:00.`;
  return d && t && isDstHour(d, t) ? `This ${which} time does not exist or happens twice in Rome on this day (clock change). Choose another time.` : undefined;
}

/** Which input a boundary problem points at, so only that one is outlined: the day, the time, or both (an order rule). */
export function boundaryPart(day: string, time: string): 'day' | 'time' | 'both' {
  const d = toApiDay(day);
  if (day.trim() && !d) return 'day';
  const t = parseTime(time);
  return (time.trim() && !t) || (d && t && isDstHour(d, t)) ? 'time' : 'both';
}

/**
 * The server's step rules, checked to the minute while the admin types (so nothing waits for Save):
 * real days and 24-hour times, no 02:00-02:59 on a Rome clock-change day, closing after opening,
 * each step opening after the previous one's closing minute (the same day is fine), and (for a new
 * timeline) step 1 not before the current Rome minute `now`. Empty values wait for the save check.
 */
export function stepDateIssues(
  rows: readonly Pick<StepDraftRow, 'start' | 'end' | 'startTime' | 'endTime'>[],
  opts: { readonly now?: string } = {},
): StepDateIssue[] {
  return rows.map((r, i) => {
    const issue: { start?: string; end?: string } = {};
    issue.start = boundaryIssue(r.start, r.startTime, 'opening');
    issue.end = boundaryIssue(r.end, r.endTime, 'closing');
    const start = toApiMoment(r.start, r.startTime);
    const end = toApiMoment(r.end, r.endTime);
    if (start && end && end <= start) issue.end ??= 'Must close after it opens.';
    const prev = i > 0 ? toApiMoment(rows[i - 1].end, rows[i - 1].endTime) : '';
    if (start && prev && start <= prev) issue.start ??= `Must open after step ${i} closes (${formatMoment(prev)}).`;
    if (i === 0 && start && opts.now && start < opts.now) issue.start ??= `Can't open before now (${formatMoment(opts.now)} Rome time).`;
    if (!issue.start) delete issue.start;
    if (!issue.end) delete issue.end;
    return issue;
  });
}
