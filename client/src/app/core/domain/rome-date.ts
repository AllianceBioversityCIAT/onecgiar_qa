// Rome days (`YYYY-MM-DD`) and Rome moments (`YYYY-MM-DDTHH:mm`, wall clock, no offset) of the QA API
// (front contracts D-1 and timeline step times, P2-4020). They stay strings: `new Date(...)` would read
// them in the viewer's zone and shift the day or the hour. Arithmetic is on plain numbers through
// Date.UTC; the current Rome minute comes from Intl.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** What a day-only value means on the server: a step opens at 00:00 and closes at 23:59. */
export const DEFAULT_OPENS_TIME = '00:00';
export const DEFAULT_CLOSES_TIME = '23:59';

export interface DayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Real calendar day or null (`2026-02-30` is null). */
export function parseDay(text: string | null | undefined): DayParts | null {
  const m = ISO_DAY.exec(text ?? '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** `YYYY-MM-DD` strings compare correctly as text. */
export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day of month of the last Sunday of a month (EU summer time starts/ends on it). */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/**
 * Rome zone label for a time of a day: CEST in summer (last Sunday of March to last Sunday of October),
 * CET otherwise. On the two switch days the clock moves at 02:00, so the time decides.
 */
export function zoneAt(day: string, time: string): 'CET' | 'CEST' {
  const d = parseDay(day);
  if (!d) return 'CET';
  const key = d.month * 100 + d.day;
  const start = 300 + lastSunday(d.year, 3);
  const end = 1000 + lastSunday(d.year, 10);
  if (key === start) return time < '02:00' ? 'CET' : 'CEST';
  if (key === end) return time < '02:00' ? 'CEST' : 'CET';
  return key > start && key < end ? 'CEST' : 'CET';
}

/** Zone of a day's opening (00:00, 'start') or closing (23:59, 'end') minute. */
export function romeZone(text: string, at: 'start' | 'end' = 'start'): 'CET' | 'CEST' {
  return zoneAt(text, at === 'start' ? DEFAULT_OPENS_TIME : DEFAULT_CLOSES_TIME);
}

/**
 * True for 02:00-02:59 on a Rome clock-change day: that hour does not exist (spring) or happens twice
 * (autumn), and the server refuses it (`DST_HOUR`).
 */
export function isDstHour(day: string, time: string): boolean {
  const d = parseDay(day);
  if (!d || !time.startsWith('02:')) return false;
  return (d.month === 3 || d.month === 10) && d.day === lastSunday(d.year, d.month);
}

/**
 * 24-hour time as people type it → `HH:mm`, or null: `9` → 09:00, `930` → 09:30, `9:05` → 09:05.
 * No AM/PM: the contract asks the 24-hour clock.
 */
export function parseTime(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t) ?? /^(\d{1,2})()$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2] || 0)];
  return h > 23 || min > 59 ? null : `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** `2026-11-12T14:00` → `{ day: '2026-11-12', time: '14:00' }`; anything else is null. */
export function splitMoment(text: string | null | undefined): { day: string; time: string } | null {
  const m = ISO_MOMENT.exec(text ?? '');
  return m ? { day: m[1], time: m[2] } : null;
}

/** `2026-11-12T14:00` → `12 Nov 2026, 14:00`; anything else is returned as given. */
export function formatMoment(text: string): string {
  const m = splitMoment(text);
  return m ? `${formatDay(m.day)}, ${m.time}` : text;
}

/** `2026-07-06` → `06 Jul 2026`; anything else is returned as given. */
export function formatDay(text: string): string {
  const d = parseDay(text);
  return d ? `${String(d.day).padStart(2, '0')} ${MONTHS[d.month - 1]} ${d.year}` : text;
}

/** `Opens 06 Jul 2026, 14:00 CEST (Rome)`: the label the contract asks wherever a step moment shows. */
export function opensLabel(day: string, time: string = DEFAULT_OPENS_TIME): string {
  return `Opens ${formatDay(day)}, ${time} ${zoneAt(day, time)} (Rome)`;
}

export function closesLabel(day: string, time: string = DEFAULT_CLOSES_TIME): string {
  return `Closes ${formatDay(day)}, ${time} ${zoneAt(day, time)} (Rome)`;
}

/** Where the API gives only the opening day (field-config preview): no time is invented. */
export function opensDayLabel(day: string): string {
  return `Opens ${formatDay(day)} (Rome)`;
}

/** The current minute in Rome as `YYYY-MM-DDTHH:mm` (for comfort pre-checks; the server decides). */
export function nowInRome(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Today's calendar day in Rome as `YYYY-MM-DD` (for comfort pre-checks; the server decides). */
export function todayInRome(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
