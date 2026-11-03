import {
  closesLabel,
  compareDays,
  formatDay,
  formatMoment,
  isDstHour,
  nowInRome,
  opensDayLabel,
  opensLabel,
  parseDay,
  parseTime,
  romeZone,
  splitMoment,
  todayInRome,
  zoneAt,
} from './rome-date';

describe('rome-date', () => {
  it('parses only real calendar days', () => {
    expect(parseDay('2026-07-06')).toEqual({ year: 2026, month: 7, day: 6 });
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('06 Jul 2026')).toBeNull();
    expect(parseDay(null)).toBeNull();
  });

  it('formats without shifting the day, whatever the viewer zone', () => {
    expect(formatDay('2026-07-06')).toBe('06 Jul 2026');
    expect(formatDay('2026-01-01')).toBe('01 Jan 2026');
    expect(formatDay('bad')).toBe('bad');
  });

  it('labels summer and winter time (2026: CEST 29 Mar to 24 Oct)', () => {
    expect(romeZone('2026-03-28')).toBe('CET');
    expect(romeZone('2026-03-29')).toBe('CET');
    expect(romeZone('2026-03-30')).toBe('CEST');
    expect(romeZone('2026-07-06')).toBe('CEST');
    expect(romeZone('2026-10-24')).toBe('CEST');
    expect(romeZone('2026-10-25')).toBe('CEST');
    expect(romeZone('2026-10-26')).toBe('CET');
    expect(romeZone('2026-12-01')).toBe('CET');
    // Switch days: 23:59 is already in the new zone.
    expect(romeZone('2026-03-29', 'end')).toBe('CEST');
    expect(romeZone('2026-10-25', 'end')).toBe('CET');
    expect(romeZone('2026-10-24', 'end')).toBe('CEST');
  });

  it('writes the contract labels', () => {
    expect(opensLabel('2026-07-06')).toBe('Opens 06 Jul 2026, 00:00 CEST (Rome)');
    expect(closesLabel('2026-11-20')).toBe('Closes 20 Nov 2026, 23:59 CET (Rome)');
  });

  it('compares days as text and knows today in Rome', () => {
    expect(compareDays('2026-07-06', '2026-07-10')).toBeLessThan(0);
    // 23:30 UTC on 21 Oct is already 22 Oct in Rome (CEST, UTC+2).
    expect(todayInRome(new Date(Date.UTC(2026, 9, 21, 23, 30)))).toBe('2026-10-22');
  });

  it('reads 24-hour times the way people type them', () => {
    expect(parseTime('14:00')).toBe('14:00');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('930')).toBe('09:30');
    expect(parseTime('0930')).toBe('09:30');
    expect(parseTime(' 9:05 ')).toBe('09:05');
    expect(parseTime('0')).toBe('00:00');
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('2pm')).toBeNull();
    expect(parseTime('')).toBeNull();
  });

  it('knows the current minute in Rome, whatever the viewer zone', () => {
    // 13:05 UTC on 29 Oct 2026 is 14:05 in Rome (CET since 25 Oct).
    expect(nowInRome(new Date(Date.UTC(2026, 9, 29, 13, 5)))).toBe('2026-10-29T14:05');
    // Midnight prints 00, never 24.
    expect(nowInRome(new Date(Date.UTC(2026, 9, 29, 23, 0)))).toBe('2026-10-30T00:00');
  });

  it('splits and formats Rome moments without building a Date', () => {
    expect(splitMoment('2026-11-12T14:00')).toEqual({ day: '2026-11-12', time: '14:00' });
    expect(splitMoment('2026-11-12')).toBeNull();
    expect(formatMoment('2026-11-12T14:00')).toBe('12 Nov 2026, 14:00');
  });

  it('refuses 02:00-02:59 only on the two clock-change days (2026: 29 Mar, 25 Oct; 2027: 28 Mar, 31 Oct)', () => {
    expect(isDstHour('2026-03-29', '02:30')).toBe(true);
    expect(isDstHour('2026-10-25', '02:00')).toBe(true);
    expect(isDstHour('2027-03-28', '02:59')).toBe(true);
    expect(isDstHour('2027-10-31', '02:15')).toBe(true);
    expect(isDstHour('2026-03-29', '01:59')).toBe(false);
    expect(isDstHour('2026-03-29', '03:00')).toBe(false);
    expect(isDstHour('2026-03-30', '02:30')).toBe(false);
  });

  it('names the zone of a time, also on the clock-change days', () => {
    expect(zoneAt('2026-11-12', '14:00')).toBe('CET');
    expect(zoneAt('2026-07-06', '09:00')).toBe('CEST');
    expect(zoneAt('2026-03-29', '01:59')).toBe('CET');
    expect(zoneAt('2026-03-29', '03:00')).toBe('CEST');
    expect(zoneAt('2026-10-25', '01:59')).toBe('CEST');
    expect(zoneAt('2026-10-25', '03:00')).toBe('CET');
  });

  it('labels print the stored time; day-only places say only the day', () => {
    expect(opensLabel('2026-11-12', '14:00')).toBe('Opens 12 Nov 2026, 14:00 CET (Rome)');
    expect(closesLabel('2026-07-06', '17:30')).toBe('Closes 06 Jul 2026, 17:30 CEST (Rome)');
    expect(opensDayLabel('2026-11-12')).toBe('Opens 12 Nov 2026 (Rome)');
  });
});
