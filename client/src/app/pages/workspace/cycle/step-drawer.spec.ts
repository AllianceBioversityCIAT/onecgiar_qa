import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OFFICIAL_TIMELINE, TIMELINES } from './cycle.mock';
import { StepDrawer, StepRequest } from './step-drawer';

const SUB = TIMELINES.find((t) => t.id !== OFFICIAL_TIMELINE.id)!;

@Component({
  imports: [StepDrawer],
  template: `<qa-cycle-step-drawer [(open)]="open" [request]="request()" [live]="true" />`,
})
class Host {
  readonly open = signal(true);
  readonly request = signal<StepRequest>({ timeline: SUB, isOfficial: false, index: 0 });
}

const nameInput = () => document.querySelector<HTMLInputElement>('#cycle-step-name')!;
const nameError = () => document.querySelector('#cycle-step-name-err')?.textContent?.trim() ?? '';

async function settle(fixture: ComponentFixture<Host>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
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
});
