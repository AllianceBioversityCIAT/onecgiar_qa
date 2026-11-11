import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, throwError } from 'rxjs';
import { LoadsApi } from '../../../core/api/loads-api';
import { LoadPreview } from '../../../core/api/loads.models';
import { RomeClock } from '../../../core/domain/rome-clock';
import { ApiError } from '../../../core/http/api-envelope';
import { Timeline } from './cycle.mock';
import { LoadDrawer, LoadDrawerNames, RunRequest } from './load-drawer';

const target = (id: string, apiId: number, name: string): Timeline => ({
  id,
  apiId,
  name,
  kind: 'Sub-timeline',
  status: 'Scheduled',
  results: 0,
  programs: ['SP02'],
  types: [],
  steps: [{ name: 'Assessors review', audience: 'Assessors', start: '10 Nov 2026', end: '12 Nov 2026', batch: true, ran: '' }],
});
const T27 = target('t27', 27, 'July');
const T28 = target('t28', 28, 'September');

const preview = (over: Partial<LoadPreview> = {}): LoadPreview => ({
  phaseYear: 2026,
  window: 'open',
  round: 1,
  stepPosition: 1,
  toLoad: {
    total: 33,
    new: 33,
    resubmitted: 0,
    byProgram: [{ programId: 11, code: 'SP02', count: 33 }],
    byResultType: [{ key: 'kp', count: 3 }, { key: 'innovation_dev', count: 30 }],
  },
  returnedNotResubmitted: { total: 0, byProgram: [], byResultType: [] },
  kpGroups: { notInQa: 0, autoChecked: 1, review: 2 },
  skipped: [
    { reason: 'ACTIVE_IN_OTHER_TIMELINE', count: 4, timelines: [{ id: 28, name: 'September', count: 4 }] },
    { reason: 'brand_new_reason', count: 1 },
  ],
  ...over,
});

const NAMES: LoadDrawerNames = {
  program: (id, code) => (id === 11 ? 'SP02 Climate' : (code ?? '')),
  type: (key) => (key === 'kp' ? 'Knowledge product' : key),
};

@Component({
  imports: [LoadDrawer],
  template: `<qa-cycle-load-drawer [(open)]="open" [request]="request()" [targets]="targets" [names]="names" [busy]="busy()" (start)="started.push($event.id)" />`,
})
class Host {
  readonly open = signal(true);
  readonly request = signal<RunRequest>({ timelineId: 't28', fromStep: false });
  targets: Timeline[] = [T27, T28];
  readonly names = NAMES;
  readonly busy = signal(false);
  readonly started: string[] = [];
}

let answer: (id: number) => Observable<LoadPreview>;
let asked: number[];

async function render(): Promise<ComponentFixture<Host>> {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const loadButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Load results')!;

describe('LoadDrawer', () => {
  beforeEach(() => {
    asked = [];
    answer = () => of(preview());
    TestBed.configureTestingModule({
      providers: [{ provide: LoadsApi, useValue: { preview: (id: number) => (asked.push(id), answer(id)) } }],
    });
  });

  it('opens on the requested timeline, shows its scope read-only and the server preview', async () => {
    await render();
    expect(asked).toEqual([28]);
    const t = text();
    expect(t).toContain('SP02');
    expect(t).toContain('All result types');
    expect(t).toContain('About 33 results will be loaded into QA round 1, step 1 (2026 phase)');
    // Round 1 with nothing re-submitted: no split line, no returned block.
    expect(t).not.toContain('submitted again');
    expect(t).not.toContain('Waiting for their program');
    expect(t).toContain('SP02 Climate');
    expect(t).toContain('Knowledge product');
    expect(t).toContain('Already in another timeline');
    expect(t).toContain('September: 4');
    // An unknown reason is shown as given, never an error.
    expect(t).toContain('brand_new_reason');
    expect(loadButton().disabled).toBe(false);
    // No free filters or step picker any more.
    expect(document.querySelector('#cycle-load-types')).toBeNull();
    expect(document.querySelector('#cycle-load-programs')).toBeNull();
  });

  it('nothing to load: says so and the start stays off', async () => {
    answer = () => of(preview({ toLoad: { total: 0, new: 0, resubmitted: 0, byProgram: [], byResultType: [] }, skipped: [] }));
    await render();
    expect(text()).toContain('No new submitted results match this timeline right now.');
    expect(text()).not.toContain('About 0');
    expect(text()).not.toContain('This is an estimate');
    expect(loadButton().disabled).toBe(true);
  });

  it('last step closed on the server: says so and the start stays off', async () => {
    answer = () => of(preview({ window: 'closed' }));
    await render();
    expect(text()).toContain('The last step of this timeline has closed');
    expect(text()).not.toContain('Step 1 of this timeline');
    expect(loadButton().disabled).toBe(true);
  });

  it('round 2: names the round and step from the server and splits new and re-submitted results', async () => {
    answer = () =>
      of(
        preview({
          round: 2,
          stepPosition: 3,
          toLoad: { total: 33, new: 28, resubmitted: 5, byProgram: [{ programId: 11, code: 'SP02', count: 33 }], byResultType: [{ key: 'kp', count: 33 }] },
        }),
      );
    await render();
    const t = text();
    expect(t).toContain('About 33 results will be loaded into QA round 2, step 3 (2026 phase)');
    expect(t).toContain('28 new and 5 submitted again after being returned in round 1');
    expect(loadButton().disabled).toBe(false);
  });

  it('results returned in round 1 and not submitted again: shown with their programs and types', async () => {
    answer = () =>
      of(
        preview({
          round: 2,
          stepPosition: 3,
          returnedNotResubmitted: { total: 7, byProgram: [{ programId: 11, count: 6 }, { programId: 99, code: 'SP09', count: 1 }], byResultType: [{ key: 'kp', count: 7 }] },
          skipped: [{ reason: 'RETURNED_NOT_RESUBMITTED', count: 6 }],
        }),
      );
    await render();
    const t = text();
    expect(t).toContain('Waiting for their program: 7');
    expect(t).toContain('SP02 Climate');
    expect(t).toContain('SP09');
    // The skip reason in plain words, never the code.
    expect(t).toContain('Returned in round 1, not submitted again yet');
    expect(t).not.toContain('RETURNED_NOT_RESUBMITTED');
  });

  it('preview failed: explains and offers to try again', async () => {
    answer = () => throwError(() => new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' }));
    const fixture = await render();
    expect(text()).toContain('We could not get the preview.');
    expect(loadButton().disabled).toBe(true);
    answer = () => of(preview());
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('About 33 results');
  });

  it('no QA catalog for the cycle year (409 LOADS_CATALOG_MISSING): says why, no "Try again", no start', async () => {
    answer = () => throwError(() => new ApiError({ status: 409, code: 'LOADS_CATALOG_MISSING', message: 'server text' }));
    await render();
    expect(text()).toContain('has no QA fields set up for this cycle');
    expect(text()).not.toContain('We could not get the preview');
    expect([...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Try again')).toBe(false);
    expect(loadButton().disabled).toBe(true);
  });

  it('emits one start per click and none while busy', async () => {
    const fixture = await render();
    loadButton().click();
    expect(fixture.componentInstance.started).toEqual(['t28']);
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    loadButton().click();
    expect(fixture.componentInstance.started).toEqual(['t28']);
  });

  it('a page left open follows the clock: the step a sync enters moves when the next step opens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T08:00:00Z')); // 12 Nov, 09:00 in Rome: step 1 in force
      const twoSteps: Timeline = {
        ...T28,
        steps: [
          { name: 'Assessors review', audience: 'Assessors', start: '10 Nov 2026', end: '12 Nov 2026', batch: true, ran: '' },
          { name: 'Programs respond', audience: 'Assessors', start: '13 Nov 2026', end: '15 Nov 2026', batch: false, ran: '' },
        ],
      };
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.targets = [T27, twoSteps];
      fixture.detectChanges();
      await fixture.whenStable();
      const drawer = fixture.debugElement.query(By.directive(LoadDrawer)).componentInstance as LoadDrawer;
      const stepOf = () => drawer['options']().find((o) => o.value === 't28')?.description;
      expect(stepOf()).toContain('Step 1');

      vi.setSystemTime(new Date('2026-11-13T08:00:00Z')); // next day, 09:00 in Rome: step 2 opened
      TestBed.inject(RomeClock).tick();
      expect(stepOf()).toContain('Step 2');
    } finally {
      vi.useRealTimers();
    }
  });
});
