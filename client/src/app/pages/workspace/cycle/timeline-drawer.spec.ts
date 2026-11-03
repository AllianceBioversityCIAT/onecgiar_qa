import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OFFICIAL_TIMELINE, TIMELINES } from './cycle.mock';
import { TimelineDrawer, TimelineRequest } from './timeline-drawer';

const SUB = TIMELINES.find((t) => t.id !== OFFICIAL_TIMELINE.id)!;

@Component({
  imports: [TimelineDrawer],
  template: `<qa-cycle-timeline-drawer [(open)]="open" [request]="request()" [official]="official" [live]="true" />`,
})
class Host {
  readonly open = signal(true);
  readonly request = signal<TimelineRequest>({ timeline: SUB });
  readonly official = OFFICIAL_TIMELINE;
}

const nameInput = () => document.querySelector<HTMLInputElement>('#cycle-tl-name')!;
const nameError = () => document.querySelector('#cycle-tl-name-err')?.textContent?.trim() ?? '';

async function settle(fixture: ComponentFixture<Host>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function leaveNameEmpty(fixture: ComponentFixture<Host>): Promise<void> {
  const input = nameInput();
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  await settle(fixture);
}

describe('TimelineDrawer', () => {
  it('opens a new timeline without the name error left over from the previous one', async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);

    await leaveNameEmpty(fixture);
    expect(nameError()).toBe('Enter a name for the timeline.');

    fixture.componentInstance.request.set({ timeline: null });
    await settle(fixture);

    expect(nameInput().value).toBe('');
    expect(nameError()).toBe('');
  });

  it('still shows the name error once the admin leaves the new name empty', async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    fixture.componentInstance.request.set({ timeline: null });
    await settle(fixture);

    await leaveNameEmpty(fixture);

    expect(nameError()).toBe('Enter a name for the timeline.');
  });

  it('a new timeline starts every step at the server defaults, 00:00 to 23:59 Rome time (P2-4021)', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.request.set({ timeline: null });
    await settle(fixture);

    const times = (kind: 'opening' | 'closing') =>
      OFFICIAL_TIMELINE.steps.map((_, i) => document.querySelector<HTMLInputElement>(`input[aria-label="Step ${i + 1} ${kind} time, 24-hour, Rome"]`)?.value);
    expect(times('opening').every((v) => v === '00:00')).toBe(true);
    expect(times('closing').every((v) => v === '23:59')).toBe(true);
    expect(document.body.textContent).toContain('Rome time (CET / CEST), 24-hour clock');
  });

  it('tidies a typed time when the admin leaves it', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.request.set({ timeline: null });
    await settle(fixture);

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Step 2 opening time, 24-hour, Rome"]')!;
    input.value = '1305';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle(fixture);

    expect(input.value).toBe('13:05');
  });
});
