// Dates in this module are `YYYY-MM-DD` strings in the Europe/Rome calendar
// (DD-2, DD-5). They never become a local-zone `Date`: the only zone-aware step
// is `todayInRome`, and it asks `Intl` for Rome's calendar day (P-5). The
// process zone (`TZ`) never changes the answer.

const ROME_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Rome calendar day of an instant, as `YYYY-MM-DD` (FR-8, FR-12). */
export function todayInRome(now: Date): string {
  const parts = Object.fromEntries(
    ROME_DAY.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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
