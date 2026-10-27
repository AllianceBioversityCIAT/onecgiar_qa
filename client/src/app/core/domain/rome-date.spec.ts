import { closesLabel, compareDays, formatDay, opensLabel, parseDay, romeZone, todayInRome } from './rome-date';

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
});
