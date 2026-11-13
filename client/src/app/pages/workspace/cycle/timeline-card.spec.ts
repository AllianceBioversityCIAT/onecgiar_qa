import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CycleStep, Timeline } from './cycle.mock';
import { timelineVM } from './cycle.logic';
import { TimelineCard } from './timeline-card';

// 3 Nov 2026, 10:00 in Rome (CET, UTC+1).
const NOW = new Date('2026-11-03T09:00:00Z');

const step = (name: string, start: string, end: string, state: CycleStep['state']): CycleStep => ({
  name,
  audience: 'Assessors',
  start,
  end,
  batch: false,
  ran: '',
  state,
});

const LIVE: Timeline = {
  id: 'tl-7',
  name: 'July batch',
  kind: 'Sub-timeline',
  status: 'Live',
  results: 12,
  programs: [],
  types: [],
  steps: [
    { ...step('Assess', '20 Oct 2026', '25 Oct 2026', 'closed'), batch: true },
    step('Programs respond', '01 Nov 2026', '05 Nov 2026', 'in_progress'),
    step('Lead', '06 Nov 2026', '08 Nov 2026', 'upcoming'),
  ],
  apiId: 7,
  version: 1,
};

describe('TimelineCard — collapsible complementary batch', () => {
  let fixture: ComponentFixture<TimelineCard>;
  const el = () => fixture.nativeElement as HTMLElement;
  const toggle = () => el().querySelector<HTMLButtonElement>('h3 button');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    fixture = TestBed.createComponent(TimelineCard);
    fixture.componentRef.setInput('timeline', timelineVM(LIVE));
  });
  afterEach(() => vi.useRealTimers());

  it('closed: hides the steps and says the step that matters now in one line', () => {
    fixture.componentRef.setInput('collapsible', true);
    fixture.componentRef.setInput('expanded', false);
    fixture.detectChanges();

    expect(el().querySelector('qa-cycle-timeline-steps')).toBeNull();
    expect(el().querySelector('[data-testid="timeline-now"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'In progress Step 2 of 3 · Programs respond closes 05 Nov, 23:59 CET',
    );
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('the title opens and closes it, and tells the view (expandedChange)', () => {
    fixture.componentRef.setInput('collapsible', true);
    fixture.componentRef.setInput('expanded', false);
    fixture.detectChanges();
    const seen: boolean[] = [];
    fixture.componentInstance.expanded.subscribe((v) => seen.push(v));

    toggle()?.click();
    fixture.detectChanges();

    expect(seen).toEqual([true]);
    expect(el().querySelector('qa-cycle-timeline-steps')).not.toBeNull();
    expect(el().querySelector('[data-testid="timeline-now"]')).toBeNull();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle()?.getAttribute('aria-controls')).toBe(el().querySelector('qa-cycle-timeline-steps')?.parentElement?.id);
  });

  it('closed and on hold: names the step without repeating the "Waiting for results" header badge', () => {
    const held: Timeline = { ...LIVE, status: 'Waiting for results', steps: LIVE.steps.map((p) => ({ ...p, state: 'upcoming' as const })) };
    fixture.componentRef.setInput('timeline', timelineVM(held));
    fixture.componentRef.setInput('collapsible', true);
    fixture.componentRef.setInput('expanded', false);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="timeline-now"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Step 1 of 3 · Assess');
    expect(el().textContent?.match(/Waiting for results/g)).toHaveLength(1);
  });

  it('not collapsible (default): always shows the steps and no toggle', () => {
    fixture.detectChanges();

    expect(el().querySelector('qa-cycle-timeline-steps')).not.toBeNull();
    expect(toggle()).toBeNull();
    expect(el().querySelector('[data-testid="timeline-now"]')).toBeNull();
  });

  describe('what needs the admin', () => {
    const none = { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 };
    const withActions = () => {
      const actions: string[] = [];
      fixture.componentInstance.menuAction.subscribe((a) => actions.push(a));
      return actions;
    };

    it('a step nobody can work: warning on the step and "Assign people" asks the view for People', () => {
      const t: Timeline = { ...LIVE, steps: LIVE.steps.map((p, i) => (i === 1 ? { ...p, audienceKey: 'assessors' as const } : p)), assigned: none };
      fixture.componentRef.setInput('timeline', timelineVM(t));
      fixture.detectChanges();
      const actions = withActions();

      expect(el().textContent).toContain('No assessors assigned');
      [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Assign people')!.click();
      expect(actions).toEqual(['people']);
    });

    it('collapsed, the one-line summary also says nobody is assigned', () => {
      const t: Timeline = { ...LIVE, steps: LIVE.steps.map((p, i) => (i === 1 ? { ...p, audienceKey: 'assessors' as const } : p)), assigned: none };
      fixture.componentRef.setInput('timeline', timelineVM(t));
      fixture.componentRef.setInput('collapsible', true);
      fixture.componentRef.setInput('expanded', false);
      fixture.detectChanges();

      expect(el().querySelector('[data-testid="timeline-now"]')?.textContent).toContain('No one assigned');
    });

    const loadBtn = () => [...el().querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Load results into QA round'));

    it('on hold and able to load: the card button carries the full name and runs the load action', () => {
      const held: Timeline = { ...LIVE, status: 'Waiting for results', steps: LIVE.steps.map((p) => ({ ...p, state: 'upcoming' as const })) };
      fixture.componentRef.setInput('timeline', timelineVM(held, true));
      fixture.detectChanges();
      const actions = withActions();

      expect(loadBtn()?.textContent).toContain('Load results into QA round 1');
      loadBtn()!.click();
      expect(actions).toEqual(['add-results']);
    });

    it('no load button when the timeline cannot take a sync now', () => {
      const held: Timeline = { ...LIVE, status: 'Waiting for results', steps: LIVE.steps.map((p) => ({ ...p, state: 'upcoming' as const })) };
      fixture.componentRef.setInput('timeline', timelineVM(held, false));
      fixture.detectChanges();
      expect(loadBtn()).toBeUndefined();
    });

    it('a live timeline with a step nobody can work: an "Assign people" button on the card opens People', () => {
      const t: Timeline = { ...LIVE, apiId: 7, steps: LIVE.steps.map((p, i) => (i === 1 ? { ...p, audienceKey: 'assessors' as const } : p)), assigned: none };
      fixture.componentRef.setInput('timeline', timelineVM(t));
      fixture.componentRef.setInput('collapsible', true);
      fixture.componentRef.setInput('expanded', false);
      fixture.detectChanges();
      const actions = withActions();

      const assign = [...el().querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Assign people'));
      expect(assign).toBeDefined();
      assign!.click();
      expect(actions).toEqual(['people']);
    });

    it('open, the card does not repeat "Assign people": the step keeps its own link', () => {
      const t: Timeline = { ...LIVE, steps: LIVE.steps.map((p, i) => (i === 1 ? { ...p, audienceKey: 'assessors' as const } : p)), assigned: none };
      fixture.componentRef.setInput('timeline', timelineVM(t));
      fixture.componentRef.setInput('collapsible', true);
      fixture.componentRef.setInput('expanded', true);
      fixture.detectChanges();
      expect([...el().querySelectorAll('button')].filter((b) => b.textContent?.trim().startsWith('Assign people')).length).toBe(1);
    });
  });
});
