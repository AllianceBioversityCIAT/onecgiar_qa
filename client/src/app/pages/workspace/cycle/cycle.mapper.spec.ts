import { Timeline as ApiTimeline } from '../../../core/api/cycles.models';
import {
  CycleCatalogs,
  OFFICIAL_ID,
  boundaryPart,
  nextAudience,
  roundsOf,
  stepDateIssues,
  toApiDay,
  toCreateBody,
  toUpdateBody,
  toViewTimeline,
} from './cycle.mapper';
import { daysFromToday, officialRelative, stepOrderErrors, stepRow, timelineVM } from './cycle.logic';

const cat: CycleCatalogs = {
  programs: [
    { id: 11, code: 'SP02', name: 'Climate' },
    { id: 15, code: 'SP05', name: 'Food' },
  ],
  types: [{ key: 'kp', name: 'Knowledge product' }],
};

/** A day alone means the server defaults: opens at 00:00, closes at 23:59 (Rome). */
const step = (position: number, opens: string, closes: string, state: 'closed' | 'in_progress' | 'upcoming' = 'upcoming') => ({
  position,
  name: `Step ${position}`,
  audience: (['assessors', 'programs', 'lead_assessors', 'tpb', 'ppu'] as const)[position - 1],
  opensAt: opens.includes('T') ? opens : `${opens}T00:00`,
  closesAt: closes.includes('T') ? closes : `${closes}T23:59`,
  round: position < 3 ? 1 : 2,
  requiresLoad: position === 1 || position === 3,
  state,
});

const api = (over: Partial<ApiTimeline> = {}): ApiTimeline => ({
  id: 7,
  cycleId: 2,
  name: 'July',
  kind: 'additional',
  allPrograms: false,
  programIds: [11, 99],
  allResultTypes: true,
  resultTypeKeys: [],
  steps: [step(2, '2027-07-08', '2027-07-09'), step(1, '2027-07-06', '2027-07-07', 'in_progress')],
  status: 'live',
  currentStep: 1,
  nextStep: 2,
  readiness: [],
  assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
  version: 3,
  timeZone: 'Europe/Rome',
  createdAt: '2026-10-22T10:00:00Z',
  ...over,
});

describe('cycle.mapper', () => {
  it('maps a timeline to the view: day text, status, codes, steps by position, state and version', () => {
    const t = toViewTimeline(api(), cat);
    expect(t).toMatchObject({ id: '7', apiId: 7, version: 3, kind: 'Sub-timeline', status: 'Live', programs: ['SP02', '#99'], types: [] });
    expect(t.steps.map((s) => [s.name, s.start, s.end, s.state, s.audienceKey])).toEqual([
      ['Step 1', '06 Jul 2027', '07 Jul 2027', 'in_progress', 'assessors'],
      ['Step 2', '08 Jul 2027', '09 Jul 2027', 'upcoming', 'programs'],
    ]);
  });

  it('reads the Rome hour and minute of each step (P2-4020), never through the viewer zone', () => {
    const t = toViewTimeline(api({ steps: [step(1, '2027-07-06T14:00', '2027-07-07T17:30')] }), cat);
    expect(t.steps.map((s) => [s.start, s.startTime, s.end, s.endTime])).toEqual([['06 Jul 2027', '14:00', '07 Jul 2027', '17:30']]);
  });

  it('falls back to the deprecated day keys with the server defaults when a moment is missing', () => {
    const s1 = step(1, '2027-07-06', '2027-07-07');
    const old = { ...s1, opensAt: undefined, closesAt: undefined, opensOn: '2027-07-06', closesOn: '2027-07-07' } as unknown as ApiTimeline['steps'][number];
    const t = toViewTimeline(api({ steps: [old] }), cat);
    expect(t.steps.map((s) => [s.start, s.startTime, s.end, s.endTime])).toEqual([['06 Jul 2027', '00:00', '07 Jul 2027', '23:59']]);
  });

  it('the official timeline keeps the view id "official"; waiting_for_load and finished have their own labels', () => {
    expect(toViewTimeline(api({ kind: 'official', status: 'waiting_for_load' }), cat)).toMatchObject({ id: OFFICIAL_ID, status: 'Waiting for results' });
    expect(toViewTimeline(api({ status: 'finished' }), cat).status).toBe('Closed');
  });

  it('day text goes back to YYYY-MM-DD without the time zone; nonsense gives ""', () => {
    expect(toApiDay('06 Jul 2027')).toBe('2027-07-06');
    expect(toApiDay('31 Feb 2027')).toBe('');
    expect(toApiDay('')).toBe('');
  });

  it('rounds start at 1 and grow on every later step that loads results', () => {
    expect(roundsOf([{ batch: true }, { batch: false }, { batch: true }, { batch: false }])).toEqual([1, 1, 2, 2]);
  });

  it('a new row takes the audience after the last one used', () => {
    expect(nextAudience(['assessors', 'lead_assessors'])).toBe('tpb');
    expect(nextAudience([])).toBe('assessors');
    expect(nextAudience(['ppu'])).toBeNull();
  });

  it('create: explicit scope flags, kept audiences, rounds and Rome moments only (never the day keys)', () => {
    const body = toCreateBody(
      {
        name: ' July ',
        programs: ['SP05'],
        types: [],
        steps: [
          { name: 'Open', start: '06 Jul 2027', startTime: '14:00', end: '07 Jul 2027', endTime: '23:59', batch: true, audience: 'assessors' },
          { name: 'Lead', start: '08 Jul 2027', startTime: '9', end: '08 Jul 2027', endTime: '1730', batch: true, audience: 'lead_assessors' },
        ],
      },
      cat,
    );
    expect(body).toEqual({
      name: 'July',
      allPrograms: false,
      programIds: [15],
      allResultTypes: true,
      steps: [
        { name: 'Open', audience: 'assessors', opensAt: '2027-07-06T14:00', closesAt: '2027-07-07T23:59', round: 1, requiresLoad: true },
        { name: 'Lead', audience: 'lead_assessors', opensAt: '2027-07-08T09:00', closesAt: '2027-07-08T17:30', round: 2, requiresLoad: true },
      ],
    });
  });

  it('edit: version plus only what changed; a step by position with its changed keys', () => {
    const before = toViewTimeline(api(), cat);
    const steps = before.steps.map(stepRow);
    steps[1] = { ...steps[1], end: '12 Jul 2027' };
    expect(toUpdateBody(before, { name: 'July', programs: before.programs, types: [], steps }, cat)).toEqual({
      version: 3,
      steps: [{ position: 2, closesAt: '2027-07-12T23:59' }],
    });
  });

  it('edit: a time-only change sends that boundary as a moment; the same time typed another way is no change', () => {
    const before = toViewTimeline(api(), cat);
    const steps = before.steps.map(stepRow);
    steps[0] = { ...steps[0], startTime: '9:30' };
    steps[1] = { ...steps[1], endTime: '2359' };
    expect(toUpdateBody(before, { name: 'July', programs: before.programs, types: [], steps }, cat)).toEqual({
      version: 3,
      steps: [{ position: 1, opensAt: '2027-07-06T09:30' }],
    });
  });

  it('edit: a scope change sends its flag and its list together; nothing changed gives null', () => {
    const before = toViewTimeline(api({ programIds: [11] }), cat);
    const steps = before.steps.map(stepRow);
    expect(toUpdateBody(before, { name: 'July', programs: ['SP02'], types: [], steps }, cat)).toBeNull();
    expect(toUpdateBody(before, { name: 'July', programs: ['SP02', 'SP05'], types: ['Knowledge product'], steps }, cat)).toEqual({
      version: 3,
      allPrograms: false,
      programIds: [11, 15],
      allResultTypes: false,
      resultTypeKeys: ['kp'],
    });
  });

  it('the official timeline never sends a name', () => {
    const before = toViewTimeline(api({ kind: 'official' }), cat);
    const steps = before.steps.map(stepRow);
    expect(toUpdateBody(before, { name: 'Other', programs: before.programs, types: [], steps }, cat)).toBeNull();
  });
});

describe('cycle.logic on API rules', () => {
  it('two steps never share a day', () => {
    expect(stepOrderErrors([{ start: '06 Jul 2027', end: '07 Jul 2027' }, { start: '07 Jul 2027', end: '08 Jul 2027' }])).toEqual([false, true]);
    expect(stepOrderErrors([{ start: '06 Jul 2027', end: '07 Jul 2027' }, { start: '08 Jul 2027', end: '08 Jul 2027' }])).toEqual([false, false]);
  });

  it('"Reset to official timeline" keeps each step\'s audience (the official may skip one)', () => {
    const official = toViewTimeline(
      api({ kind: 'official', steps: [step(1, '2027-07-06', '2027-07-07'), { ...step(3, '2027-07-08', '2027-07-09'), position: 2 }] }),
      cat,
    );
    expect(officialRelative('01 Sep 2027', official).map((r) => r.audience)).toEqual(['assessors', 'lead_assessors']);
  });

  it('"Reset to official timeline" keeps each official step\'s hour and minute', () => {
    const official = toViewTimeline(api({ kind: 'official', steps: [step(1, '2027-07-06T09:00', '2027-07-07T12:00'), step(2, '2027-07-07T13:00', '2027-07-09T17:30')] }), cat);
    expect(officialRelative('16 Jul 2027', official).map((r) => [r.start, r.startTime, r.end, r.endTime])).toEqual([
      ['16 Jul 2027', '09:00', '17 Jul 2027', '12:00'],
      ['17 Jul 2027', '13:00', '19 Jul 2027', '17:30'],
    ]);
  });

  it('"Reset to official timeline" shifts by whole days across a summer-time change', () => {
    const official = toViewTimeline(api({ kind: 'official', steps: [step(1, '2027-03-01', '2027-03-02'), step(2, '2027-04-05', '2027-04-06')] }), cat);
    expect(officialRelative('01 Oct 2027', official).map((r) => [r.start, r.end])).toEqual([
      ['01 Oct 2027', '02 Oct 2027'],
      ['05 Nov 2027', '06 Nov 2027'],
    ]);
  });

  it('days until a step opens count from today in Rome', () => {
    expect(daysFromToday('25 Oct 2026', '2026-10-22')).toBe(3);
    expect(daysFromToday('01 Mar 2027', '2027-02-28')).toBe(1);
  });
});

/** A row with the default times unless given. */
const row = (start: string, end: string, startTime = '00:00', endTime = '23:59') => ({ start, end, startTime, endTime });

describe('stepDateIssues (live checks while typing, to the minute)', () => {
  it('flags the exact field: closing before opening, opening before the previous step closes, not a real date or time', () => {
    expect(
      stepDateIssues([
        row('22 Oct 2026', '30 Oct 2026'),
        row('30 Oct 2026', '01 Oct 2026'),
        row('31 Feb 2027', ''),
        row('01 Dec 2026', '02 Dec 2026', '25:00'),
      ]),
    ).toEqual([
      {},
      { start: 'Must open after step 1 closes (30 Oct 2026, 23:59).', end: 'Must close after it opens.' },
      { start: 'Not a real opening date. Use the format 06 Jul 2026.' },
      { start: 'Not a real opening time. Use the 24-hour clock, for example 14:00.' },
    ]);
  });

  it('two steps may share a day when the next one opens after the previous closing minute', () => {
    expect(stepDateIssues([row('12 Nov 2026', '12 Nov 2026', '09:00', '12:00'), row('12 Nov 2026', '13 Nov 2026', '13:00')])).toEqual([{}, {}]);
    expect(stepDateIssues([row('12 Nov 2026', '12 Nov 2026', '09:00', '12:00'), row('12 Nov 2026', '13 Nov 2026', '12:00')])).toEqual([
      {},
      { start: 'Must open after step 1 closes (12 Nov 2026, 12:00).' },
    ]);
  });

  it('points a boundary problem at the right input: the day, the time, or both for an order rule', () => {
    expect(boundaryPart('31 Feb 2027', '09:00')).toBe('day');
    expect(boundaryPart('12 Nov 2026', '5pm')).toBe('time');
    expect(boundaryPart('28 Mar 2027', '02:30')).toBe('time');
    expect(boundaryPart('12 Nov 2026', '09:00')).toBe('both');
  });

  it('closing at the same minute as opening is refused', () => {
    expect(stepDateIssues([row('12 Nov 2026', '12 Nov 2026', '14:00', '14:00')])).toEqual([{ end: 'Must close after it opens.' }]);
  });

  it('02:00-02:59 on a Rome clock-change day is refused before sending', () => {
    expect(stepDateIssues([row('28 Mar 2027', '29 Mar 2027', '02:30')])).toEqual([
      { start: 'This opening time does not exist or happens twice in Rome on this day (clock change). Choose another time.' },
    ]);
  });

  it('step 1 of a new timeline cannot open before the current Rome minute; later today is fine', () => {
    expect(stepDateIssues([row('29 Oct 2026', '30 Oct 2026', '14:00')], { now: '2026-10-29T14:05' })).toEqual([
      { start: "Can't open before now (29 Oct 2026, 14:05 Rome time)." },
    ]);
    expect(stepDateIssues([row('29 Oct 2026', '30 Oct 2026', '15:00')], { now: '2026-10-29T14:05' })).toEqual([{}]);
    expect(stepDateIssues([row('', '')], { now: '2026-10-29T14:05' })).toEqual([{}]);
  });
});

describe('timeline cards show Rome times', () => {
  it('each step card has its times and zone; the timeline range has its first and last minute', () => {
    const vm = timelineVM(
      toViewTimeline(api({ steps: [step(1, '2026-11-12T09:00', '2026-11-12T12:00'), step(2, '2026-11-12T13:00', '2026-11-20T17:30')] }), cat),
    );
    expect(vm.steps.map((s) => [s.from, s.to, s.opensTime])).toEqual([
      ['12 Nov, 09:00 –', '12:00 CET', '09:00'],
      ['12 Nov, 13:00 –', '20 Nov, 17:30 CET', '13:00'],
    ]);
    expect(vm.range).toBe('12 Nov, 09:00 – 20 Nov 2026, 17:30 CET');
  });

  it('a step or a timeline across the autumn clock change names the zone at both ends', () => {
    const vm = timelineVM(toViewTimeline(api({ steps: [step(1, '2026-10-20T09:00', '2026-10-30T17:00')] }), cat));
    expect([vm.steps[0].from, vm.steps[0].to]).toEqual(['20 Oct, 09:00 CEST –', '30 Oct, 17:00 CET']);
    expect(vm.range).toBe('20 Oct, 09:00 CEST – 30 Oct 2026, 17:00 CET');
  });
});

describe('timeline cards on the hold', () => {
  it('waiting_for_load: step 1 says "Waiting for results", not "Opens in 0 days"', () => {
    const vm = timelineVM(toViewTimeline(api({ status: 'waiting_for_load', steps: [step(1, '2026-10-22', '2026-10-30'), step(2, '2026-10-31', '2026-11-01')] }), cat));
    expect(vm.steps.map((s) => [s.state, s.waiting])).toEqual([
      ['future', true],
      ['future', false],
    ]);
  });
});
