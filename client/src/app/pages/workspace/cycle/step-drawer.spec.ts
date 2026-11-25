import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OFFICIAL_TIMELINE, TIMELINES } from './cycle.mock';
import { StepDrawer, StepRequest, StepSaveEvent } from './step-drawer';
import type { TimelineSaveFeedback } from './timeline-drawer';

const SUB = TIMELINES.find((t) => t.id !== OFFICIAL_TIMELINE.id)!;

@Component({
  imports: [StepDrawer],
  template: `<qa-cycle-step-drawer [(open)]="open" [request]="request()" [live]="true" [loadable]="loadable()" [feedback]="feedback()" (saveStep)="sent.push($event)" (loadIntoStep)="loads = loads + 1" />`,
})
class Host {
  readonly open = signal(true);
  readonly request = signal<StepRequest>({ timeline: SUB, isOfficial: false, index: 0 });
  readonly sent: StepSaveEvent[] = [];
  readonly loadable = signal(false);
  readonly feedback = signal<TimelineSaveFeedback | null>(null);
  loads = 0;
}

const nameInput = () => document.querySelector<HTMLInputElement>('#cycle-step-name')!;
const nameError = () => document.querySelector('#cycle-step-name-err')?.textContent?.trim() ?? '';

async function settle(fixture: ComponentFixture<Host>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const field = (selector: string) => document.querySelector<HTMLInputElement>(selector)!;

async function type(fixture: ComponentFixture<Host>, input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  await settle(fixture);
}

describe('StepDrawer', () => {
  it('"Load results into this step" waits while the step has unsaved edits, so nothing typed is lost (N-1)', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.loadable.set(true);
    // A step with nothing loaded yet, so the footer offers the load.
    fixture.componentInstance.request.set({ timeline: { ...SUB, steps: SUB.steps.map((p, i) => (i === 0 ? { ...p, ran: '' } : p)) }, isOfficial: false, index: 0 });
    await settle(fixture);
    const loadBtn = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Load results into this step')!;
    expect(loadBtn().disabled).toBe(false);

    await type(fixture, nameInput(), 'Renamed step');

    expect(loadBtn().disabled).toBe(true);
    expect(document.body.textContent).toContain('Save or cancel your changes to load results.');
    loadBtn().click();
    await settle(fixture);
    expect(fixture.componentInstance.loads).toBe(0);
    expect(fixture.componentInstance.open()).toBe(true);
  });

  it('opens another step without the name error left over from the previous one', async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);

    const input = nameInput();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(nameError()).toBe('Enter a name for the step.');

    fixture.componentInstance.request.set({ timeline: SUB, isOfficial: false, index: null });
    await settle(fixture);

    expect(nameError()).toBe('');
  });

  it('a new step sends the Rome times typed next to its dates, tidied to HH:mm (P2-4021)', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.request.set({ timeline: SUB, isOfficial: false, index: null });
    await settle(fixture);

    const opensTime = field('input[aria-label="Opening time, 24-hour, Rome"]');
    const closesTime = field('input[aria-label="Closing time, 24-hour, Rome"]');
    expect([opensTime.value, closesTime.value]).toEqual(['00:00', '23:59']);

    await type(fixture, nameInput(), 'Late programs');
    await type(fixture, field('input[aria-labelledby="cycle-step-opens"]'), '12 Nov 2030');
    await type(fixture, opensTime, '930');
    await type(fixture, field('input[aria-labelledby="cycle-step-closes"]'), '12 Nov 2030');
    await type(fixture, closesTime, '17:30');
    expect(opensTime.value).toBe('09:30');
    expect(document.body.textContent).toContain('Rome time (CET), 24-hour clock.');

    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Add step')!.click();
    await settle(fixture);

    expect(fixture.componentInstance.sent.map((e) => [e.step.start, e.step.startTime, e.step.end, e.step.endTime])).toEqual([
      ['12 Nov 2030', '09:30', '12 Nov 2030', '17:30'],
    ]);
  });

  it('flags a time that is not a 24-hour time', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.request.set({ timeline: SUB, isOfficial: false, index: null });
    await settle(fixture);

    await type(fixture, field('input[aria-labelledby="cycle-step-opens"]'), '12 Nov 2030');
    await type(fixture, field('input[aria-labelledby="cycle-step-closes"]'), '13 Nov 2030');
    await type(fixture, field('input[aria-label="Closing time, 24-hour, Rome"]'), '5pm');

    expect(document.querySelector('#cycle-step-opens-err')?.textContent?.trim()).toBe('Enter a closing time, for example 17:30.');
    // Only the field that is wrong is outlined.
    const outlined = ['input[aria-labelledby="cycle-step-opens"]', 'input[aria-label="Opening time, 24-hour, Rome"]', 'input[aria-labelledby="cycle-step-closes"]', 'input[aria-label="Closing time, 24-hour, Rome"]'].map(
      (sel) => field(sel).getAttribute('data-error'),
    );
    expect(outlined).toEqual(['false', 'false', 'false', 'true']);
  });

  describe('a closed step (P2-4080)', () => {
    // The API locks a closed step's dates only (LOCKED on opensAt / closesAt); its name can still change.
    const CLOSED = { ...SUB, steps: SUB.steps.map((p, i) => (i === 0 ? { ...p, state: 'closed' as const } : p)) };
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);

    async function openClosed(): Promise<ComponentFixture<Host>> {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.request.set({ timeline: CLOSED, isOfficial: false, index: 0 });
      await settle(fixture);
      return fixture;
    }

    it('keeps its dates as text and saves a new name', async () => {
      const fixture = await openClosed();
      expect(document.body.textContent).toContain('Its dates stay as the record of the cycle.');
      expect(document.querySelector('input[aria-labelledby="cycle-step-opens"]')).toBeNull();
      expect(button('Save step')).toBeDefined();

      await type(fixture, nameInput(), 'Assessors review (renamed)');
      button('Save step')!.click();
      await settle(fixture);

      const first = CLOSED.steps[0];
      expect(fixture.componentInstance.sent.map((e) => [e.index, e.step.name, e.step.start, e.step.end])).toEqual([[0, 'Assessors review (renamed)', first.start, first.end]]);
    });

    it('is not stopped by its stored dates, which it cannot edit and does not send', async () => {
      const fixture = TestBed.createComponent(Host);
      // Stored as closing after the next step opens: the date rule would flag it on a step that can still move.
      const clash = { ...CLOSED, steps: CLOSED.steps.map((p, i) => (i === 0 ? { ...p, end: CLOSED.steps[1].start, endTime: '23:59' } : i === 1 ? { ...p, startTime: '00:00' } : p)) };
      fixture.componentInstance.request.set({ timeline: clash, isOfficial: false, index: 0 });
      await settle(fixture);

      await type(fixture, nameInput(), 'Renamed');
      button('Save step')!.click();
      await settle(fixture);

      expect(fixture.componentInstance.sent.map((e) => e.step.name)).toEqual(['Renamed']);
    });

    it('does not send an empty name', async () => {
      const fixture = await openClosed();
      await type(fixture, nameInput(), '   ');
      button('Save step')!.click();
      await settle(fixture);

      expect(nameError()).toBe('Enter a name for the step.');
      expect(fixture.componentInstance.sent).toEqual([]);
    });

    it('shows what the server answered when the save is refused', async () => {
      const fixture = await openClosed();
      fixture.componentInstance.feedback.set({ message: 'Someone else changed this timeline. We reloaded it: review it and make your change again.', fields: [] });
      await settle(fixture);

      expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Someone else changed this timeline. We reloaded it: review it and make your change again.');
    });
  });
});
