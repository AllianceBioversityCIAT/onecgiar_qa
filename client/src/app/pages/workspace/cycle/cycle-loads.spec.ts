import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { LoadsApi } from '../../../core/api/loads-api';
import { LoadDetail, LoadItem, LoadStarted } from '../../../core/api/loads.models';
import { ApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { CycleLoads, LOAD_POLL_MS } from './cycle-loads';
import { CycleStore } from './cycle-store';
import { Timeline } from './cycle.mock';

const timeline = (id: string, apiId: number): Timeline => ({
  id,
  apiId,
  name: `T${apiId}`,
  kind: 'Sub-timeline',
  status: 'Live',
  results: 0,
  programs: [],
  types: [],
  steps: [],
});

const item = (over: Partial<LoadItem> = {}): LoadItem => ({
  id: 9,
  status: 'running',
  total: null,
  processed: 0,
  startedAt: '2026-11-05T10:00:00Z',
  finishedAt: null,
  startedBy: { id: 7, nickname: null },
  failureReason: null,
  ...over,
});

const summary = { loaded: 33, byProgram: [], byResultType: [], kpGroups: { notInQa: 0, autoChecked: 1, review: 2 }, skipped: [] };

describe('CycleLoads', () => {
  let starts: Subject<LoadStarted>;
  let startCalls: number;
  let listAnswer: () => Observable<readonly LoadItem[]>;
  let detail: LoadDetail;
  let reloads: number;
  let errors: string[];
  let loads: CycleLoads;
  const timelines = signal<readonly Timeline[]>([timeline('t27', 27), timeline('t28', 28)]);

  beforeEach(() => {
    vi.useFakeTimers();
    starts = new Subject<LoadStarted>();
    startCalls = 0;
    listAnswer = () => of([item()]);
    detail = { ...item({ status: 'completed', total: 33, processed: 33 }), summary };
    reloads = 0;
    errors = [];
    TestBed.configureTestingModule({
      providers: [
        CycleLoads,
        {
          provide: LoadsApi,
          useValue: {
            start: () => (startCalls++, starts),
            list: () => listAnswer(),
            get: () => of(detail),
          },
        },
        { provide: CycleStore, useValue: { timelines, load: () => (reloads++, Promise.resolve(true)) } },
        { provide: Toasts, useValue: { error: (m: string) => errors.push(m), success: () => undefined } },
      ],
    });
    loads = TestBed.inject(CycleLoads);
  });
  afterEach(() => vi.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  it('a double tap sends one start', async () => {
    const first = loads.start(timelines()[0]);
    const second = loads.start(timelines()[0]);
    expect(startCalls).toBe(1);
    expect(loads.starting()).toBe(true);
    starts.next({ id: 9, status: 'running' });
    starts.complete();
    await Promise.all([first, second]);
    expect(loads.starting()).toBe(false);
    expect(loads.active()).toMatchObject({ timelineId: 't27', loadId: 9, total: null, processed: 0 });
  });

  it('follows the progress every 2 s, then reads the summary and refreshes the timelines', async () => {
    const started = loads.start(timelines()[0]);
    starts.next({ id: 9, status: 'running' });
    starts.complete();
    await started;

    listAnswer = () => of([item({ total: 1200, processed: 275 })]);
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS);
    expect(loads.active()).toMatchObject({ processed: 275, total: 1200 });

    listAnswer = () => of([item({ status: 'completed', total: 33, processed: 33 })]);
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS);
    await flush();
    expect(loads.active()).toBeNull();
    expect(loads.finished()?.detail.summary.loaded).toBe(33);
    expect(loads.finished()?.timelineName).toBe('T27');
    expect(reloads).toBe(1);

    // Polling stopped.
    let polled = 0;
    listAnswer = () => (polled++, of([]));
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS * 3);
    expect(polled).toBe(0);
  });

  it('a failed load ends too, with its reason kept for the summary', async () => {
    listAnswer = () => of([item()]);
    await loads.resume(timelines());
    detail = { ...item({ status: 'failed', failureReason: 'ABANDONED' }), summary };
    listAnswer = () => of([item({ status: 'failed', failureReason: 'ABANDONED' })]);
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS);
    await flush();
    expect(loads.finished()?.detail.failureReason).toBe('ABANDONED');
  });

  it('resume follows the running load of the cycle, wherever it is', async () => {
    let calls = 0;
    listAnswer = () => (++calls === 1 ? of([item({ id: 3, status: 'completed' })]) : of([item({ id: 4 })]));
    await loads.resume(timelines());
    expect(loads.active()).toMatchObject({ timelineId: 't28', loadId: 4 });
  });

  it('resume with nothing running leaves the button free', async () => {
    listAnswer = () => of([item({ status: 'completed' })]);
    await loads.resume(timelines());
    expect(loads.running()).toBe(false);
  });

  it('a refused start says why in plain words; LOADS_ALREADY_RUNNING follows the other load', async () => {
    listAnswer = () => of([item({ id: 5 })]);
    const result = loads.start(timelines()[0]);
    starts.error(new ApiError({ status: 409, code: 'LOADS_ALREADY_RUNNING', message: 'x' }));
    expect(await result).toEqual({ ok: false, message: 'Another load in this cycle is still running. Wait for it to finish, then try again.' });
    // Already followed when the answer comes back, so the view can close the drawer right away.
    expect(loads.active()?.loadId).toBe(5);
  });

  it('Reporting down at start: nothing loaded, try again later', async () => {
    const result = loads.start(timelines()[0]);
    starts.error(new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'x' }));
    expect(await result).toEqual({ ok: false, message: 'The Reporting Tool is not answering. Nothing was loaded: try again in a few minutes.' });
    expect(loads.running()).toBe(false);
  });

  it('a poll that fails keeps trying; after about a minute it gives up and says so', async () => {
    listAnswer = () => of([item()]);
    await loads.resume(timelines());
    listAnswer = () => throwError(() => new Error('offline'));
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS * 5);
    expect(loads.running()).toBe(true);
    await vi.advanceTimersByTimeAsync(LOAD_POLL_MS * 30);
    expect(loads.running()).toBe(false);
    expect(errors[0]).toContain('lost track of the load');
  });
});
