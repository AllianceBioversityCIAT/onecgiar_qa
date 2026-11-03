import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OFFICIAL_TIMELINE, TIMELINES } from './cycle.mock';
import { StepDrawer, StepRequest, StepSaveEvent } from './step-drawer';

const SUB = TIMELINES.find((t) => t.id !== OFFICIAL_TIMELINE.id)!;

@Component({
  imports: [StepDrawer],
  template: `<qa-cycle-step-drawer [(open)]="open" [request]="request()" [live]="true" (saveStep)="sent.push($event)" />`,
})
class Host {
  readonly open = signal(true);
  readonly request = signal<StepRequest>({ timeline: SUB, isOfficial: false, index: 0 });
  readonly sent: StepSaveEvent[] = [];
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
});
