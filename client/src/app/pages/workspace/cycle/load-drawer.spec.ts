import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { LoadsApi } from '../../../core/api/loads-api';
import { LoadPreview } from '../../../core/api/loads.models';
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
  toLoad: {
    total: 33,
    byProgram: [{ programId: 11, code: 'SP02', count: 33 }],
    byResultType: [{ key: 'kp', count: 3 }, { key: 'innovation_dev', count: 30 }],
  },
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
  readonly targets = [T27, T28];
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
    expect(t).toContain('About 33 results will be loaded into step 1');
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
    answer = () => of(preview({ toLoad: { total: 0, byProgram: [], byResultType: [] }, skipped: [] }));
    await render();
    expect(text()).toContain('No new submitted results match this timeline right now.');
    expect(loadButton().disabled).toBe(true);
  });

  it('step 1 closed on the server: says so and the start stays off', async () => {
    answer = () => of(preview({ window: 'closed' }));
    await render();
    expect(text()).toContain('Step 1 of this timeline has closed');
    expect(loadButton().disabled).toBe(true);
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

  it('emits one start per click and none while busy', async () => {
    const fixture = await render();
    loadButton().click();
    expect(fixture.componentInstance.started).toEqual(['t28']);
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    loadButton().click();
    expect(fixture.componentInstance.started).toEqual(['t28']);
  });
});
