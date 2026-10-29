// Days are `YYYY-MM-DD` strings and moments are `YYYY-MM-DDTHH:mm` strings
// (`RomeMinute`), both in the Europe/Rome calendar (DD-1, DD-3). They never
// become a local-zone `Date`: the only zone-aware step is `nowInRome`, and it
// asks `Intl` for Rome's wall clock (P-5). The process zone (`TZ`) never
// changes the answer.

/** The one QA clock zone (FR-10): the only `'Europe/Rome'` in `server/src`. */
export const QA_TIME_ZONE = 'Europe/Rome';

const ROME_MINUTE = new Intl.DateTimeFormat('en-CA', {
  timeZone: QA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const ROME_OFFSET = new Intl.DateTimeFormat('en-US', {
  timeZone: QA_TIME_ZONE,
  timeZoneName: 'longOffset',
});

const MINUTE_SHAPE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** A Rome wall-clock minute, `YYYY-MM-DDTHH:mm` (DD-3). A bare day does not fit. */
export type RomeMinute = string & { readonly __brand: 'RomeMinute' };

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written exactly `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_SHAPE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Negative, zero or positive, for two valid date strings (lexical order is date order). */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A valid date string moved by whole days, on the calendar only (no zone). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** True for exactly `YYYY-MM-DDTHH:mm`: a real date, hour 00-23, minute 00-59 (FR-1). */
export function isRomeMinute(value: string): value is RomeMinute {
  const match = MINUTE_SHAPE.exec(value);
  if (!match) return false;
  return (
    isCalendarDate(match[1]!) &&
    Number(match[2]) <= 23 &&
    Number(match[3]) <= 59
  );
}

/** The Rome wall-clock minute of an instant; seconds are dropped (DD-2, FR-2, FR-7). */
export function nowInRome(instant: Date): RomeMinute {
  const parts = Object.fromEntries(
    ROME_MINUTE.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` as RomeMinute;
}

/** `T00:00` of a day-only date (FR-9, FR-11, S-6). */
export function dayStart(day: string): RomeMinute {
  return `${day}T00:00` as RomeMinute;
}

/** `T23:59` of a day-only date (FR-9, FR-11, S-6). */
export function dayEnd(day: string): RomeMinute {
  return `${day}T23:59` as RomeMinute;
}

/** The `YYYY-MM-DD` part of a minute (FR-9, FR-13). */
export function dayOf(minute: RomeMinute): string {
  return minute.slice(0, 10);
}

/** Negative, zero or positive, for two minutes (lexical order is time order). */
export function compareMinutes(a: RomeMinute, b: RomeMinute): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function romeOffsetMinutes(instant: Date): number {
  const label =
    ROME_OFFSET.formatToParts(instant).find((p) => p.type === 'timeZoneName')
      ?.value ?? 'GMT';
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(label);
  if (!match || !match[1]) return 0;
  const total = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -total : total;
}

/**
 * True for 02:00-02:59 on a day whose Rome UTC offset differs between its start
 * and its end: the hour that does not exist or happens twice (FR-4). Read from
 * `Intl`, never from a hand-written "last Sunday" rule (DD-4).
 */
export function isDstHour(minute: RomeMinute): boolean {
  if (minute.slice(11, 13) !== '02') return false;
  const [year, month, day] = minute.slice(0, 10).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  // Probes sit inside the Rome day at its edges; no change falls near midnight.
  const early = new Date(Date.UTC(year, month - 1, day - 1, 23, 0));
  const late = new Date(Date.UTC(year, month - 1, day, 21, 0));
  return romeOffsetMinutes(early) !== romeOffsetMinutes(late);
}
