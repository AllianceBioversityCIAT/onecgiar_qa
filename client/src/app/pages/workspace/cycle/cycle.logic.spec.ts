import { TestBed } from '@angular/core/testing';
import { CycleStep, Timeline } from './cycle.mock';
import { loadTargets, officialRelative, stepInForce, stepRound, timelineVM } from './cycle.logic';
import { TimelineSteps } from './timeline-steps';

// 3 Nov 2026, 10:00 in Rome (CET, UTC+1).
const NOW = new Date('2026-11-03T09:00:00Z');

const step = (name: string, start: string, end: string, startTime?: string): CycleStep => ({
  name,
  audience: 'Assessors',
  start,
  end,
  startTime,
  batch: false,
  ran: '',
  state: 'upcoming',
});

const timeline = (status: Timeline['status'], steps: CycleStep[]): Timeline => ({
  id: 'tl-9',
  name: 'Test',
  kind: 'Sub-timeline',
  status,
  results: 0,
  programs: [],
  types: [],
  steps,
  apiId: 9,
  version: 1,
});

/** On hold since 28 Oct: the server sends every step as `upcoming`, even the ones whose days went by. */
const HELD = timeline('Waiting for results', [
  step('Assess', '28 Oct 2026', '30 Oct 2026'),
  step('Programs respond', '31 Oct 2026', '01 Nov 2026'),
  step('Opened this morning', '03 Nov 2026', '04 Nov 2026', '09:30'),
  step('Opens this afternoon', '03 Nov 2026', '05 Nov 2026', '15:00'),
  step('Next week', '10 Nov 2026', '12 Nov 2026'),
]);

describe('cycle.logic', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  describe('timelineVM — a timeline on hold (waiting for results)', () => {
    it('shows "Waiting for results" on every step whose opening minute already went by', () => {
      expect(timelineVM(HELD).steps.map((s) => s.waiting)).toEqual([true, true, true, false, false]);
    });

    it('keeps "Opens today at" for a step that opens later today, and the day count for later steps', () => {
      const [, , , later, nextWeek] = timelineVM(HELD).steps;
      expect([later.state, later.days, later.opensTime]).toEqual(['future', 0, '15:00']);
      expect([nextWeek.state, nextWeek.days]).toEqual(['future', 7]);
    });

    it('never marks a step as waiting when the timeline is not on hold', () => {
      const scheduled = timeline('Scheduled', HELD.steps.slice(3));
      expect(timelineVM(scheduled).steps.map((s) => s.waiting)).toEqual([false, false]);
    });

    it('renders no "Opens today at 00:00" on a step whose days are over', () => {
      const fixture = TestBed.createComponent(TimelineSteps);
      fixture.componentRef.setInput('timeline', timelineVM(HELD));
      fixture.detectChanges();
      const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li')].map((li) => li.textContent ?? '');

      expect(cards[1]).toContain('Waiting for results');
      expect(cards[1]).not.toContain('Opens today');
      expect(cards[3]).toContain('Opens today at 15:00');
    });
  });

  describe('officialRelative — "Reset to main batch"', () => {
    const official = (startTime: string) =>
      timeline('Live', [step('Assess', '01 Sep 2026', '05 Sep 2026', startTime), step('Programs respond', '07 Sep 2026', '11 Sep 2026')]);

    it('starts tomorrow when step 1 has no day yet and its opening minute already went by today', () => {
      const rows = officialRelative('', official('00:00'));
      expect(rows.map((r) => [r.start, r.end, r.startTime])).toEqual([
        ['04 Nov 2026', '08 Nov 2026', '00:00'],
        ['10 Nov 2026', '14 Nov 2026', '00:00'],
      ]);
    });

    it('starts today when step 1 has no day yet and opens later today', () => {
      expect(officialRelative('', official('14:00'))[0].start).toBe('03 Nov 2026');
    });

    it('starts on the day the admin typed in step 1', () => {
      expect(officialRelative('20 Nov 2026', official('00:00')).map((r) => r.start)).toEqual(['20 Nov 2026', '26 Nov 2026']);
    });
  });

  describe('loadTargets — timelines that can take a sync now (until the last step closes)', () => {
    const NOW_ROME = '2026-11-03T10:00';
    const withSteps = (id: string, steps: CycleStep[], apiId: number | null = 1): Timeline => ({ ...timeline('Live', steps), id, apiId: apiId ?? undefined });

    it('keeps an open or future timeline and drops one whose last step closed', () => {
      const list = [
        withSteps('open', [{ ...step('Assess', '02 Nov 2026', '05 Nov 2026'), state: 'in_progress' }]),
        withSteps('future', [step('Assess', '10 Nov 2026', '12 Nov 2026')]),
        withSteps('closed', [{ ...step('Assess', '20 Oct 2026', '25 Oct 2026'), state: 'closed' }]),
      ];
      expect(loadTargets(list, NOW_ROME).map((t) => t.id)).toEqual(['open', 'future']);
    });

    it('step 1 closed but a later step still open: the timeline can still sync (contract P-13)', () => {
      const t = withSteps('later', [
        { ...step('Assess', '20 Oct 2026', '25 Oct 2026'), state: 'closed' },
        { ...step('Programs respond', '02 Nov 2026', '05 Nov 2026'), state: 'in_progress' },
        step('Re-assess', '10 Nov 2026', '12 Nov 2026'),
      ]);
      expect(loadTargets([t], NOW_ROME).map((x) => x.id)).toEqual(['later']);
    });

    it('last step closing today: the closing minute itself is still open, the next one is not', () => {
      const today = withSteps('today', [{ ...step('Assess', '01 Nov 2026', '03 Nov 2026'), endTime: '10:30', state: 'in_progress' }]);
      expect(loadTargets([today], NOW_ROME).length).toBe(1);
      expect(loadTargets([today], '2026-11-03T10:30').length).toBe(1);
      expect(loadTargets([today], '2026-11-03T10:31').length).toBe(0);
    });

    it('a timeline the server does not know yet (mock) is never a target', () => {
      expect(loadTargets([withSteps('mock', [step('Assess', '10 Nov 2026', '12 Nov 2026')], null)], NOW_ROME)).toEqual([]);
    });
  });

  describe('stepInForce / stepRound — where a sync started now goes', () => {
    const roundTwo = (): Timeline =>
      timeline('Live', [
        { ...step('Assess', '20 Oct 2026', '25 Oct 2026'), batch: true, round: 1 },
        { ...step('Programs respond', '26 Oct 2026', '30 Oct 2026'), round: 1 },
        { ...step('Re-assess', '02 Nov 2026', '05 Nov 2026'), batch: true, round: 2 },
        { ...step('Final', '10 Nov 2026', '12 Nov 2026'), round: 2 },
      ]);

    it('is the last step whose opening minute went by', () => {
      expect(stepInForce(roundTwo(), '2026-11-03T10:00')).toBe(2);
      expect(stepRound(roundTwo(), 2)).toBe(2);
    });

    it('is step 1 before any step opens', () => {
      expect(stepInForce(roundTwo(), '2026-10-01T10:00')).toBe(0);
    });

    it('a gap after a step closed still belongs to that step', () => {
      expect(stepInForce(roundTwo(), '2026-10-31T12:00')).toBe(1);
      expect(stepRound(roundTwo(), 1)).toBe(1);
    });

    it('without a stored round (mock), counts the "Loads results" switches', () => {
      const t = roundTwo();
      const mock = { ...t, steps: t.steps.map(({ round: _r, ...p }) => p) };
      expect(mock.steps.map((_, i) => stepRound(mock, i))).toEqual([1, 1, 2, 2]);
    });
  });

  describe('timelineVM — "Load results into QA round N" in the menu', () => {
    it('is offered only when the view says the timeline can load, named after the round in force', () => {
      const t = timeline('Live', [step('Assess', '10 Nov 2026', '12 Nov 2026')]);
      expect(timelineVM(t, true).menu.find((m) => m.action === 'add-results')).toMatchObject({ label: 'Load results into QA round 1', soon: false });
      expect(timelineVM(t, false).menu.some((m) => m.action === 'add-results')).toBe(false);
    });

    it('says round 2 once a round-2 step is in force', () => {
      const t = timeline('Live', [
        { ...step('Assess', '20 Oct 2026', '25 Oct 2026'), batch: true, round: 1, state: 'closed' },
        { ...step('Re-assess', '01 Nov 2026', '05 Nov 2026'), batch: true, round: 2, state: 'in_progress' },
      ]);
      expect(timelineVM(t, true).menu.find((m) => m.action === 'add-results')?.label).toBe('Load results into QA round 2');
    });
  });
});
