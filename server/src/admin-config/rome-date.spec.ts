import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  isCalendarDate,
  todayInRome,
} from './rome-date.js';

// Expected values are literal: Rome is UTC+1 in winter (CET) and UTC+2 in
// summer (CEST); the 2026 changes are 29 Mar (02:00 -> 03:00 CET to CEST) and
// 25 Oct (03:00 -> 02:00 CEST to CET).
describe('todayInRome', () => {
  it.each([
    [
      'winter, 22:59Z is still the same Rome day',
      '2026-01-15T22:59:00Z',
      '2026-01-15',
    ],
    [
      'winter, 23:00Z is the next Rome day',
      '2026-01-15T23:00:00Z',
      '2026-01-16',
    ],
    [
      'summer, 21:59Z is still the same Rome day',
      '2026-07-15T21:59:00Z',
      '2026-07-15',
    ],
    [
      'summer, 22:00Z is the next Rome day',
      '2026-07-15T22:00:00Z',
      '2026-07-16',
    ],
    [
      '25 Oct, 21:30Z is 23:30 Rome, still 25 Oct',
      '2026-10-25T21:30:00Z',
      '2026-10-25',
    ],
    [
      '25 Oct, 23:30Z is 00:30 Rome on 26 Oct',
      '2026-10-25T23:30:00Z',
      '2026-10-26',
    ],
    [
      '25 Oct, 22:59Z is 23:59 Rome (CET), still 25 Oct',
      '2026-10-25T22:59:00Z',
      '2026-10-25',
    ],
    [
      '25 Oct, 23:00Z is midnight Rome, 26 Oct',
      '2026-10-25T23:00:00Z',
      '2026-10-26',
    ],
    [
      '29 Mar, 22:59Z is 00:59 CEST on 30 Mar',
      '2026-03-29T22:59:00Z',
      '2026-03-30',
    ],
    [
      '29 Mar, 21:59Z is 23:59 CEST, still 29 Mar',
      '2026-03-29T21:59:00Z',
      '2026-03-29',
    ],
    [
      '28 Mar, 22:59Z is 23:59 CET, still 28 Mar',
      '2026-03-28T22:59:00Z',
      '2026-03-28',
    ],
    [
      '28 Mar, 23:00Z is midnight CET, 29 Mar',
      '2026-03-28T23:00:00Z',
      '2026-03-29',
    ],
    [
      'year end, 23:30Z on 31 Dec is 1 Jan in Rome',
      '2026-12-31T23:30:00Z',
      '2027-01-01',
    ],
  ])('%s', (_name, instant, expected) => {
    expect(todayInRome(new Date(instant))).toBe(expected);
  });
});

describe('isCalendarDate', () => {
  it.each(['2026-02-03', '2026-10-25', '2028-02-29', '2026-12-31'])(
    'accepts %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-2-3',
    '26-02-03',
    '2026-02-03T00:00:00Z',
    ' 2026-02-03',
    '',
  ])('refuses %j', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe('compareDates', () => {
  it('orders date strings', () => {
    expect(compareDates('2026-10-25', '2026-10-26')).toBeLessThan(0);
    expect(compareDates('2026-11-01', '2026-10-31')).toBeGreaterThan(0);
    expect(compareDates('2026-10-25', '2026-10-25')).toBe(0);
  });
});

describe('addDays', () => {
  it.each([
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-03-28', 2, '2026-03-30'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-10-26', -1, '2026-10-25'],
  ])('%s + %i days = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});
