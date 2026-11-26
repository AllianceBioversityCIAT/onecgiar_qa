import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AssessmentApi } from '../../../core/api/assessment-api';
import { WorklistOptions, WorklistPage, WorklistQuery, WorklistRow, WorklistTimelines } from '../../../core/api/assessment.models';
import { ApiError } from '../../../core/http/api-envelope';
import { ResultsView } from './results-view';

const row = (code: string, patch: Partial<WorklistRow> = {}): WorklistRow => ({
  membershipId: Number(code),
  resultCode: Number(code),
  title: `Result ${code}`,
  updated: false,
  program: { id: 7, code: 'SP02', name: 'Breeding' },
  resultType: { key: 'innovation_development', label: 'Innovation development' },
  comments: 0,
  answeredBySp: 0,
  assessedBy: null,
  status: 'pending',
  canOpen: true,
  readOnlyReason: null,
  ...patch,
});

const TIMELINES: WorklistTimelines = {
  timelines: [
    {
      id: 29,
      name: 'Main 2026',
      kind: 'official',
      roles: ['ASSESSOR'],
      step: { position: 1, name: 'Assessment', opensAt: '2026-11-01T09:00', closesAt: '2026-11-30T18:00', state: 'in_progress' },
    },
    { id: 30, name: 'Extra', kind: 'additional', roles: ['ASSESSOR'], step: null },
  ],
  defaultTimelineId: 29,
  timeZone: 'Europe/Rome',
};

const OPTIONS: WorklistOptions = {
  programs: [{ id: 7, code: 'SP02', name: 'Breeding' }],
  resultTypes: [{ key: 'innovation_development', label: 'Innovation development' }],
  statuses: [
    { key: 'pending', label: 'Pending' },
    { key: 'quality_assessed', label: 'Quality Assessed' },
  ],
};

const page = (rows: readonly WorklistRow[], patch: Partial<WorklistPage> = {}): WorklistPage => ({
  rows,
  counters: { pending: rows.length, finished: 0, total: rows.length },
  writable: true,
  noActiveRole: false,
  nextCursor: null,
  ...patch,
});

/** Worklist API double: records every page request and answers what the test queued (default: two rows). */
class FakeApi {
  timelinesAnswer: () => Observable<WorklistTimelines> = () => of(TIMELINES);
  pageAnswer: (id: number, q: WorklistQuery) => Observable<WorklistPage> = () => of(page([row('9890'), row('9891')]));
  readonly calls: { id: number; query: WorklistQuery }[] = [];

  timelines(): Observable<WorklistTimelines> {
    return this.timelinesAnswer();
  }
  optionsAnswer: (id: number) => Observable<WorklistOptions> = () => of(OPTIONS);

  worklistOptions(id: number): Observable<WorklistOptions> {
    return this.optionsAnswer(id);
  }
  worklist(id: number, query: WorklistQuery = {}): Observable<WorklistPage> {
    this.calls.push({ id, query });
    return this.pageAnswer(id, query);
  }
  last(): { id: number; query: WorklistQuery } {
    return this.calls[this.calls.length - 1];
  }
}

describe('ResultsView on the worklist API', () => {
  let api: FakeApi;
  let router: Router;
  let started: string[];

  const open = async (url: string) => {
    const harness = await RouterTestingHarness.create(url);
    await settle(harness);
    return harness;
  };
  const settle = async (harness: RouterTestingHarness) => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      harness.detectChanges();
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const text = (harness: RouterTestingHarness) => harness.routeNativeElement?.textContent?.replace(/\s+/g, ' ') ?? '';
  const codes = (harness: RouterTestingHarness) =>
    [...(harness.routeNativeElement?.querySelectorAll('tbody a') ?? [])].map((a) => a.textContent?.trim());

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'results', component: ResultsView }]), { provide: AssessmentApi, useValue: api }],
    });
    router = TestBed.inject(Router);
    started = [];
    router.events.subscribe((e) => {
      if (e instanceof NavigationStart) started.push(e.url);
    });
  });

  it('opens the default timeline with no status filter: the server lists Auto-validated with the rest (F-010)', async () => {
    const harness = await open('/results');
    expect(api.calls).toHaveLength(1); // one load, not two (the creating navigation is skipped once)
    expect(api.last().id).toBe(29);
    expect(api.last().query.status).toEqual([]);
    expect(codes(harness)).toEqual(['9890', '9891']);
  });

  it('loading shows the skeleton with the shape of the table', async () => {
    const pending = new Subject<WorklistPage>();
    api.pageAnswer = () => pending;
    const harness = await RouterTestingHarness.create('/results');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('qa-results-skeleton')).not.toBeNull();
    pending.next(page([row('9890')]));
    pending.complete();
    await settle(harness);
    expect(harness.routeNativeElement?.querySelector('qa-results-skeleton')).toBeNull();
    expect(codes(harness)).toEqual(['9890']);
  });

  it('URL filters reach the server; unknown values and the old ?stage= are dropped (DD-13)', async () => {
    await open('/results?timeline=30&status=pending,not-a-status&program=7,abc&type=innovation_development&q=bean&stage=r1-two');
    const { id, query } = api.last();
    expect(id).toBe(30);
    expect(query.status).toEqual(['pending']);
    expect(query.programId).toEqual([7]);
    expect(query.resultTypeKey).toEqual(['innovation_development']);
    expect(query.q).toBe('bean');
  });

  it('a timeline in the URL that is not offered falls back to the default one', async () => {
    await open('/results?timeline=999');
    expect(api.last().id).toBe(29);
  });

  it('sorting asks the server (sort and dir params) and the header says so with aria-sort', async () => {
    const harness = await open('/results');
    const header = [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('thead th button')].find((b) =>
      b.textContent?.includes('Status'),
    )!;
    header.click();
    await settle(harness);
    expect(api.last().query).toMatchObject({ sort: 'status', dir: 'asc' });
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('ascending');

    header.click();
    await settle(harness);
    expect(api.last().query).toMatchObject({ sort: 'status', dir: 'desc' });
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('the table shows the rows in the order the server sent them (no client sort)', async () => {
    api.pageAnswer = () => of(page([row('9999'), row('1000')]));
    const harness = await open('/results');
    expect(codes(harness)).toEqual(['9999', '1000']);
  });

  it('"Load more" appends the next page with the cursor and the same query', async () => {
    api.pageAnswer = (_id, q) =>
      of(q.cursor ? page([row('3')], { nextCursor: null }) : page([row('1'), row('2')], { nextCursor: 'c2' }));
    const harness = await open('/results?status=pending');
    const more = [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Load more'),
    )!;
    more.click();
    await settle(harness);
    expect(api.last().query).toMatchObject({ cursor: 'c2', status: ['pending'] });
    expect(codes(harness)).toEqual(['1', '2', '3']);
    expect(text(harness)).not.toContain('Load more');
  });

  it('a filter change refetches; a stale answer that lands after a newer one is dropped', async () => {
    const slow = new Subject<WorklistPage>();
    let n = 0;
    api.pageAnswer = () => (++n === 2 ? slow : of(page(n === 1 ? [row('1')] : [row('3')])));
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as {
      setStatuses(v: readonly string[]): void;
      setPrograms(v: readonly string[]): void;
    };
    comp.setStatuses(['pending']); // request 2: slow
    comp.setPrograms(['7']); // request 3: answers first
    await settle(harness);
    slow.next(page([row('2')]));
    slow.complete();
    await settle(harness);
    expect(codes(harness)).toEqual(['3']);
  });

  it('counters show above the table and ignore the filters', async () => {
    api.pageAnswer = () => of(page([row('1')], { counters: { pending: 4, finished: 6, total: 10 } }));
    const harness = await open('/results?status=pending');
    expect(text(harness)).toContain('4 pending · 6 finished · 10 in this timeline');
  });

  it('P2-3912: a Lead review that ended escalated reads "Pending for TPB review" and counts as finished (round-2 contract § 5)', async () => {
    // The server counts pending_tpb_review in `finished`; the row shows its own status pill.
    api.pageAnswer = () =>
      of(page([row('1', { status: 'pending_tpb_review', updated: true })], { counters: { pending: 0, finished: 1, total: 1 } }));
    const harness = await open('/results');
    expect(text(harness)).toContain('0 pending · 1 finished · 1 in this timeline');
    expect(text(harness)).toContain('Pending for TPB review');
  });

  it('the total says how many of them are auto-validated, and says nothing when none is (F-010)', async () => {
    api.pageAnswer = () => of(page([row('1')], { counters: { pending: 3, finished: 2, total: 7, autoValidated: 2 } }));
    const harness = await open('/results');
    expect(text(harness)).toContain('3 pending · 2 finished · 7 in this timeline, incl. 2 auto-validated');
  });

  it('no auto-validated counter (or 0) keeps the plain total', async () => {
    api.pageAnswer = () => of(page([row('1')], { counters: { pending: 4, finished: 6, total: 10 } }));
    const harness = await open('/results');
    expect(text(harness)).toContain('10 in this timeline');
    expect(text(harness)).not.toContain('auto-validated');
  });

  it('read-only banner when the step is not open', async () => {
    api.timelinesAnswer = () =>
      of({ ...TIMELINES, timelines: [{ ...TIMELINES.timelines[0], step: { ...TIMELINES.timelines[0].step!, state: 'closed' } }] });
    api.pageAnswer = () => of(page([row('1')], { writable: false }));
    const harness = await open('/results');
    expect(text(harness)).toContain('Your assessment step has closed');
  });

  it('empty: no timeline assigned', async () => {
    api.timelinesAnswer = () => of({ timelines: [], defaultTimelineId: null, timeZone: 'Europe/Rome' });
    const harness = await open('/results');
    expect(text(harness)).toContain('You are not assigned to any QA timeline yet.');
    expect(api.calls).toHaveLength(0);
  });

  it('empty: assigned but no active role (noActiveRole)', async () => {
    api.pageAnswer = () => of(page([], { noActiveRole: true }));
    const harness = await open('/results');
    expect(text(harness)).toContain('none of your roles has results to assess');
  });

  it('empty: nothing entered QA in this timeline yet', async () => {
    api.pageAnswer = () => of(page([], { counters: { pending: 0, finished: 0, total: 0 } }));
    const harness = await open('/results');
    expect(text(harness)).toContain('No results have entered QA in this timeline yet.');
  });

  it('empty: results exist but none matches the filters', async () => {
    api.pageAnswer = () => of(page([], { counters: { pending: 3, finished: 0, total: 3 } }));
    const harness = await open('/results?q=zzz');
    expect(text(harness)).toContain('No results match your filters.');
  });

  it('error shows the server message and "Try again" reloads', async () => {
    let fail = true;
    api.pageAnswer = () =>
      fail
        ? throwError(() => new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' }))
        : of(page([row('1')]));
    const harness = await open('/results');
    expect(text(harness)).toContain('The results could not load. Try again in a moment.');
    fail = false;
    [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Try again'))!.click();
    await settle(harness);
    expect(codes(harness)).toEqual(['1']);
  });

  it('each row opens its review with the timeline in the URL (the assessment needs both)', async () => {
    const harness = await open('/results?timeline=30');
    const link = harness.routeNativeElement!.querySelector<HTMLAnchorElement>('tbody a')!;
    expect(link.getAttribute('href')).toBe('/results/9890?timeline=30');
  });

  it('a filter change while a timeline switch is still loading keeps the new timeline', async () => {
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as {
      onTimeline(v: string | null): void;
      setStatuses(v: readonly string[]): void;
    };
    const timelines = new Subject<WorklistTimelines>();
    api.timelinesAnswer = () => timelines;
    comp.onTimeline('30'); // waits for the timelines answer
    comp.setStatuses(['pending']); // lands in the middle of that load
    timelines.next(TIMELINES);
    timelines.complete();
    await settle(harness);
    expect(api.last().id).toBe(30);
    expect(api.last().query.status).toEqual(['pending']);
  });

  it('a search still waiting for its pause travels with a timeline switch instead of cancelling it', async () => {
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as { onTimeline(v: string | null): void };
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('input[aria-label="Search by code or title"]')!;
    const timelines = new Subject<WorklistTimelines>();
    api.timelinesAnswer = () => timelines;
    input.value = 'bean';
    input.dispatchEvent(new Event('input'));
    comp.onTimeline('30');
    await new Promise((resolve) => setTimeout(resolve, 350)); // past the 300 ms pause of the search box
    timelines.next(TIMELINES);
    timelines.complete();
    await settle(harness);
    expect(api.last().id).toBe(30);
    expect(api.last().query.q).toBe('bean');
  });

  it('a timeline that fails to load keeps the picker, so another one can be chosen', async () => {
    api.pageAnswer = (id) =>
      id === 30
        ? throwError(() => new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again in a moment.' }))
        : of(page([row('9890')]));
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as { onTimeline(v: string | null): void };
    comp.onTimeline('30');
    await settle(harness);
    expect(text(harness)).toContain('The results could not load. Try again in a moment.');
    expect(harness.routeNativeElement!.querySelector('qa-select')).not.toBeNull();
    comp.onTimeline('29');
    await settle(harness);
    expect(codes(harness)).toEqual(['9890']);
  });

  it('switching timeline drops the program and type filters the new timeline does not offer', async () => {
    api.optionsAnswer = (id) =>
      of(id === 30 ? { ...OPTIONS, programs: [{ id: 8, code: 'SP03', name: 'Sustainable Farming' }], resultTypes: [] } : OPTIONS);
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as {
      onTimeline(v: string | null): void;
      setPrograms(v: readonly string[]): void;
      setTypes(v: readonly string[]): void;
      setStatuses(v: readonly string[]): void;
    };
    comp.setPrograms(['7']);
    comp.setTypes(['innovation_development']);
    comp.setStatuses(['pending']);
    await settle(harness);
    comp.onTimeline('30');
    await settle(harness);
    expect(api.last().id).toBe(30);
    expect(api.last().query).toMatchObject({ programId: [], resultTypeKey: [], status: ['pending'] });
    expect(harness.routeNativeElement!.querySelector('button[aria-label="Remove Science program filter"]')).toBeNull();
    expect(harness.routeNativeElement!.querySelector('button[aria-label="Remove Status filter"]')).not.toBeNull();
  });

  it('repeated values in the URL are sent once', async () => {
    await open('/results?status=pending,pending&program=7,7');
    expect(api.last().query.status).toEqual(['pending']);
    expect(api.last().query.programId).toEqual([7]);
  });

  it('a refresh overtaken by a timeline switch does not leave the table dimmed', async () => {
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as {
      onTimeline(v: string | null): void;
      setStatuses(v: readonly string[]): void;
    };
    const slow = new Subject<WorklistPage>();
    api.pageAnswer = (_id, q) => (q.status?.length ? slow : of(page([row('9890')])));
    comp.setStatuses(['pending']); // a refresh that does not answer yet
    await settle(harness);
    api.pageAnswer = () => of(page([row('9890')]));
    comp.onTimeline('30'); // a full load overtakes it
    await settle(harness);
    slow.next(page([row('1')]));
    slow.complete();
    await settle(harness);
    const table = harness.routeNativeElement!.querySelector('qa-results-table')!;
    expect(table.getAttribute('aria-busy')).toBeNull();
    expect(table.classList.contains('opacity-60')).toBe(false);
  });

  it('picking the timeline already on screen keeps a search that is still waiting for its pause', async () => {
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as { onTimeline(v: string | null): void };
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('input[aria-label="Search by code or title"]')!;
    input.value = 'bean';
    input.dispatchEvent(new Event('input'));
    comp.onTimeline('29');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle(harness);
    expect(api.last().query.q).toBe('bean');
  });

  it('a refresh that fails offers to clear the filters that may be causing it', async () => {
    const harness = await open('/results');
    const comp = harness.routeDebugElement!.componentInstance as { setStatuses(v: readonly string[]): void };
    api.pageAnswer = (_id, q) =>
      q.status?.length
        ? throwError(() => new ApiError({ status: 400, code: 'VALIDATION_FAILED', message: 'One of the filters is not valid.' }))
        : of(page([row('9890')]));
    comp.setStatuses(['pending']);
    await settle(harness);
    expect(text(harness)).toContain('The results could not load. One of the filters is not valid.');
    [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Clear filters'))!.click();
    await settle(harness);
    expect(codes(harness)).toEqual(['9890']);
    expect(api.last().query.status).toEqual([]);
  });

  it('re-reads the URL on navigation in the same component, and never writes the URL itself', async () => {
    const harness = await open('/results?status=pending');
    const before = harness.routeDebugElement?.componentInstance;
    await router.navigateByUrl('/results?status=quality_assessed');
    await settle(harness);
    expect(harness.routeDebugElement?.componentInstance).toBe(before);
    expect(api.last().query.status).toEqual(['quality_assessed']);

    // By hand: remove the chip (only signals), then the same URL again restores the filter.
    harness.routeNativeElement!.querySelector<HTMLButtonElement>('button[aria-label="Remove Status filter"]')!.click();
    await settle(harness);
    expect(api.last().query.status).toEqual([]);
    await router.navigateByUrl('/results?status=quality_assessed', { onSameUrlNavigation: 'reload' });
    await settle(harness);
    expect(api.last().query.status).toEqual(['quality_assessed']);

    expect(started).toEqual(['/results?status=pending', '/results?status=quality_assessed', '/results?status=quality_assessed']);
  });
});
