import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadDetail, LoadSummary } from '../../../core/api/loads.models';
import { FinishedLoad } from './cycle-loads';
import { LoadDrawerNames } from './load-drawer';
import { LoadSummaryDrawer } from './load-summary-drawer';

const summary = (over: Partial<LoadSummary> = {}): LoadSummary => ({
  loaded: 33,
  loadedNew: 33,
  loadedResubmitted: 0,
  round: 1,
  returnedNotResubmitted: { total: 0, byProgram: [], byResultType: [] },
  byProgram: [{ programId: 11, count: 33 }],
  byResultType: [{ key: 'kp', count: 33 }],
  kpGroups: { notInQa: 0, autoChecked: 1, review: 2 },
  skipped: [],
  ...over,
});

const detail = (over: Partial<LoadDetail> = {}, s: Partial<LoadSummary> = {}): LoadDetail => ({
  id: 9,
  status: 'completed',
  total: 33,
  processed: 33,
  startedAt: '2026-11-09T10:00:00Z',
  finishedAt: '2026-11-09T10:01:00Z',
  startedBy: { id: 7, nickname: null },
  failureReason: null,
  round: 1,
  stepPosition: 1,
  summary: summary(s),
  ...over,
});

const NAMES: LoadDrawerNames = {
  program: (id, code) => (id === 11 ? 'SP02 Climate' : (code ?? `Program ${id}`)),
  type: (key) => (key === 'kp' ? 'Knowledge product' : key),
};

@Component({
  imports: [LoadSummaryDrawer],
  template: `<qa-cycle-load-summary-drawer [open]="true" [load]="load()" [names]="names" />`,
})
class Host {
  readonly load = signal<FinishedLoad | null>(null);
  readonly names = NAMES;
}

async function render(load: FinishedLoad): Promise<ComponentFixture<Host>> {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.load.set(load);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('LoadSummaryDrawer', () => {
  it('round 1: names the round and step the sync entered, never "step 1" by default', async () => {
    await render({ timelineName: 'July', detail: detail() });
    const t = text();
    expect(t).toContain('July · QA round 1, step 1');
    expect(t).toContain('loaded');
    expect(t).not.toContain('loaded into step 1');
    expect(t).not.toContain('submitted again');
    expect(t).not.toContain('Waiting for their program');
  });

  it('round 2: splits new and re-submitted, and lists returned results not submitted again', async () => {
    await render({
      timelineName: 'July',
      detail: detail(
        { round: 2, stepPosition: 3 },
        {
          loaded: 33,
          loadedNew: 30,
          loadedResubmitted: 3,
          round: 2,
          returnedNotResubmitted: { total: 4, byProgram: [{ programId: 12, count: 4 }], byResultType: [{ key: 'kp', count: 4 }] },
        },
      ),
    });
    const t = text();
    expect(t).toContain('July · QA round 2, step 3');
    expect(t).toContain('30 new and 3 submitted again after being returned in round 1');
    expect(t).toContain('Waiting for their program: 4');
    // The stored summary has no program code: the name comes from the catalog, else the id.
    expect(t).toContain('Program 12');
  });
});
