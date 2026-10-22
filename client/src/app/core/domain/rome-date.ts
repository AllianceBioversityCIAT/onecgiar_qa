// Step dates of the QA API are Rome calendar days sent as `YYYY-MM-DD` (front contract D-1).
// They stay strings: `new Date('YYYY-MM-DD')` parses as UTC and can shift a day in the viewer's zone.
// All arithmetic here is on plain year/month/day numbers through Date.UTC, never the local zone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

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
 * Rome zone label for a day: CEST in summer (last Sunday of March to last Sunday of October), CET
 * otherwise. On the two switch days 00:00 is still in the old zone and 23:59 already in the new one,
 * so `at` says which end of the day is shown (opening = 'start', closing = 'end').
 */
export function romeZone(text: string, at: 'start' | 'end' = 'start'): 'CET' | 'CEST' {
  const d = parseDay(text);
  if (!d) return 'CET';
  const key = d.month * 100 + d.day;
  const start = 300 + lastSunday(d.year, 3);
  const end = 1000 + lastSunday(d.year, 10);
  return at === 'start' ? (key > start && key <= end ? 'CEST' : 'CET') : key >= start && key < end ? 'CEST' : 'CET';
}

/** `2026-07-06` → `06 Jul 2026`; anything else is returned as given. */
export function formatDay(text: string): string {
  const d = parseDay(text);
  return d ? `${String(d.day).padStart(2, '0')} ${MONTHS[d.month - 1]} ${d.year}` : text;
}

/** `Opens 06 Jul 2026, 00:00 CEST (Rome)`: the label the contract asks wherever a step date shows. */
export function opensLabel(text: string): string {
  return `Opens ${formatDay(text)}, 00:00 ${romeZone(text)} (Rome)`;
}

export function closesLabel(text: string): string {
  return `Closes ${formatDay(text)}, 23:59 ${romeZone(text, 'end')} (Rome)`;
}

/** Today's calendar day in Rome as `YYYY-MM-DD` (for comfort pre-checks; the server decides). */
export function todayInRome(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
