import { TestBed } from '@angular/core/testing';
import { CycleStep, Timeline } from './cycle.mock';
import { officialRelative, timelineVM } from './cycle.logic';
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
});
