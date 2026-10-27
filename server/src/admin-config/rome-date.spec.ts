import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  compareMinutes,
  dayEnd,
  dayOf,
  dayStart,
  isCalendarDate,
  isDstHour,
  isRomeMinute,
  nowInRome,
  QA_TIME_ZONE,
  todayInRome,
  type RomeMinute,
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

describe('QA_TIME_ZONE', () => {
  it('is Europe/Rome', () => {
    expect(QA_TIME_ZONE).toBe('Europe/Rome');
  });
});

describe('isRomeMinute', () => {
  it.each([
    '2026-02-03T00:00',
    '2026-10-25T23:59',
    '2028-02-29T10:30',
    '2027-03-28T02:30',
  ])('accepts %s', (value) => {
    expect(isRomeMinute(value)).toBe(true);
  });

  it.each([
    '2026-02-03T14:00:00',
    '2026-02-03T14:00Z',
    '2026-02-03T14:00+01:00',
    '2026-02-30T10:00',
    '2026-02-03T24:00',
    '2026-02-03T10:60',
    '2026-02-03T9:00',
    '2026-02-03 10:00',
    '2026-02-03',
    ' 2026-02-03T10:00',
    '',
  ])('refuses %j', (value) => {
    expect(isRomeMinute(value)).toBe(false);
  });
});

// Rome: CET = UTC+1, CEST = UTC+2. Changes: 2026-10-25 03:00 CEST -> 02:00 CET
// (02:xx happens twice) and 2027-03-28 02:00 CET -> 03:00 CEST (02:xx absent).
describe('nowInRome', () => {
  it.each([
    ['winter, seconds dropped', '2026-01-15T10:20:59Z', '2026-01-15T11:20'],
    ['summer, seconds dropped', '2026-07-15T10:20:59Z', '2026-07-15T12:20'],
    [
      'midnight in Rome, still previous UTC day',
      '2026-11-09T23:30:00Z',
      '2026-11-10T00:30',
    ],
    ['year end', '2026-12-31T23:30:00Z', '2027-01-01T00:30'],
    [
      'first occurrence of 02:30 on 25 Oct (CEST)',
      '2026-10-25T00:30:00Z',
      '2026-10-25T02:30',
    ],
    [
      'second occurrence of 02:30 on 25 Oct (CET)',
      '2026-10-25T01:30:00Z',
      '2026-10-25T02:30',
    ],
    [
      'Rome midnight is 00:00, not 24:00',
      '2026-07-14T22:00:00Z',
      '2026-07-15T00:00',
    ],
    ['just before the spring gap', '2027-03-28T00:59:00Z', '2027-03-28T01:59'],
    ['just after the spring gap', '2027-03-28T01:00:00Z', '2027-03-28T03:00'],
  ])('%s', (_name, instant, expected) => {
    expect(nowInRome(new Date(instant))).toBe(expected);
  });
});

describe('isDstHour', () => {
  it.each([
    ['2027-03-28T02:30', true],
    ['2027-03-28T02:00', true],
    ['2027-03-28T02:59', true],
    ['2026-10-25T02:15', true],
    ['2026-10-25T02:00', true],
    ['2026-10-25T03:00', false],
    ['2026-10-25T01:59', false],
    ['2027-03-28T03:00', false],
    ['2027-03-28T01:59', false],
    ['2026-07-15T02:30', false],
    ['2026-01-15T02:30', false],
  ])('%s is %s', (value, expected) => {
    expect(isDstHour(value as RomeMinute)).toBe(expected);
  });
});

describe('dayStart, dayEnd, dayOf', () => {
  it('builds the first and last minute of a day', () => {
    expect(dayStart('2026-10-25')).toBe('2026-10-25T00:00');
    expect(dayEnd('2026-10-25')).toBe('2026-10-25T23:59');
  });

  it('round-trips through dayOf and isRomeMinute', () => {
    expect(dayOf(dayStart('2026-02-03'))).toBe('2026-02-03');
    expect(dayOf(dayEnd('2026-02-03'))).toBe('2026-02-03');
    expect(isRomeMinute(dayStart('2026-02-03'))).toBe(true);
    expect(isRomeMinute(dayEnd('2026-02-03'))).toBe(true);
  });

  it('keeps a bare day out of a RomeMinute', () => {
    // @ts-expect-error a YYYY-MM-DD string is not a RomeMinute
    const minute: RomeMinute = '2026-02-03';
    expect(minute).toBe('2026-02-03');
  });
});

describe('compareMinutes', () => {
  it('orders minutes', () => {
    expect(
      compareMinutes(
        '2026-10-25T09:00' as RomeMinute,
        '2026-10-25T09:01' as RomeMinute,
      ),
    ).toBeLessThan(0);
    expect(
      compareMinutes(
        '2026-10-26T00:00' as RomeMinute,
        '2026-10-25T23:59' as RomeMinute,
      ),
    ).toBeGreaterThan(0);
    expect(
      compareMinutes(
        '2026-10-25T09:00' as RomeMinute,
        '2026-10-25T09:00' as RomeMinute,
      ),
    ).toBe(0);
  });
});
