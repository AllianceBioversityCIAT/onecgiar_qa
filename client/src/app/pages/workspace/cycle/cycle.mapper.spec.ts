import { Timeline as ApiTimeline } from '../../../core/api/cycles.models';
import { CycleCatalogs, OFFICIAL_ID, nextAudience, roundsOf, toApiDay, toCreateBody, toUpdateBody, toViewTimeline } from './cycle.mapper';
import { daysFromToday, officialRelative, stepOrderErrors } from './cycle.logic';

const cat: CycleCatalogs = {
  programs: [
    { id: 11, code: 'SP02', name: 'Climate' },
    { id: 15, code: 'SP05', name: 'Food' },
  ],
  types: [{ key: 'kp', name: 'Knowledge product' }],
};

const step = (position: number, opensOn: string, closesOn: string, state: 'closed' | 'in_progress' | 'upcoming' = 'upcoming') => ({
  position,
  name: `Step ${position}`,
  audience: (['assessors', 'programs', 'lead_assessors', 'tpb', 'ppu'] as const)[position - 1],
  opensOn,
  closesOn,
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

  it('create: explicit scope flags, kept audiences, rounds and API days', () => {
    const body = toCreateBody(
      {
        name: ' July ',
        programs: ['SP05'],
        types: [],
        steps: [
          { name: 'Open', start: '06 Jul 2027', end: '07 Jul 2027', batch: true, audience: 'assessors' },
          { name: 'Lead', start: '08 Jul 2027', end: '09 Jul 2027', batch: true, audience: 'lead_assessors' },
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
        { name: 'Open', audience: 'assessors', opensOn: '2027-07-06', closesOn: '2027-07-07', round: 1, requiresLoad: true },
        { name: 'Lead', audience: 'lead_assessors', opensOn: '2027-07-08', closesOn: '2027-07-09', round: 2, requiresLoad: true },
      ],
    });
  });

  it('edit: version plus only what changed; a step by position with its changed keys', () => {
    const before = toViewTimeline(api(), cat);
    const steps = before.steps.map((s) => ({ name: s.name, start: s.start, end: s.end, batch: s.batch }));
    steps[1] = { ...steps[1], end: '12 Jul 2027' };
    expect(toUpdateBody(before, { name: 'July', programs: before.programs, types: [], steps }, cat)).toEqual({
      version: 3,
      steps: [{ position: 2, closesOn: '2027-07-12' }],
    });
  });

  it('edit: a scope change sends its flag and its list together; nothing changed gives null', () => {
    const before = toViewTimeline(api({ programIds: [11] }), cat);
    const steps = before.steps.map((s) => ({ name: s.name, start: s.start, end: s.end, batch: s.batch }));
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
    const steps = before.steps.map((s) => ({ name: s.name, start: s.start, end: s.end, batch: s.batch }));
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
