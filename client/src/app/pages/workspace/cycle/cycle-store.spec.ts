import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { CycleStore } from './cycle-store';

const API = 'https://api.test/api/v1';
const meta = { requestId: 'r', timestamp: 't' };
const ok = (data: unknown) => ({ success: true, data, meta });
const fail = (status: number, code: string, fields: unknown[] = []) => ({
  success: false,
  error: { status, code, message: `server says ${code}`, fields },
  meta,
});

const timeline = (over: Record<string, unknown> = {}) => ({
  id: 7,
  cycleId: 2,
  name: 'July',
  kind: 'additional',
  allPrograms: true,
  programIds: [],
  allResultTypes: true,
  resultTypeKeys: [],
  steps: [
    { position: 1, name: 'Open', audience: 'assessors', opensOn: '2027-07-06', closesOn: '2027-07-07', round: 1, requiresLoad: true, state: 'in_progress' },
  ],
  status: 'live',
  currentStep: 1,
  nextStep: null,
  readiness: [],
  assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
  version: 1,
  createdAt: '2026-10-22T10:00:00Z',
  ...over,
});
const official = timeline({ id: 1, name: 'Annual', kind: 'official' });

describe('CycleStore', () => {
  let http: HttpTestingController;
  let store: CycleStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CycleStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CycleStore);
  });
  afterEach(() => http.verify());

  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  /** Answers the calls of one load (started by the test or by the store itself). */
  async function answerLoad(cycles: unknown[], timelines: unknown[] = [official, timeline()], programs: 'ok' | 'down' = 'ok'): Promise<void> {
    await settle();
    http.expectOne(`${API}/cycles`).flush(ok(cycles));
    const sp = http.expectOne(`${API}/catalogs/science-programs`);
    if (programs === 'ok') sp.flush(ok([{ id: 11, code: 'SP02', name: 'Climate' }]));
    else sp.flush(fail(503, 'SERVICE_UNAVAILABLE'), { status: 503, statusText: 'Unavailable' });
    http.expectOne(`${API}/catalogs/result-types`).flush(ok([{ key: 'kp', name: 'Knowledge product' }]));
    http.expectOne(`${API}/timeline-defaults`).flush(ok([]));
    await settle();
    const active = (cycles as { status: string; id: number }[]).find((c) => c.status === 'active');
    if (active) http.expectOne(`${API}/cycles/${active.id}/timelines`).flush(ok(timelines));
  }

  async function load(cycles: unknown[], timelines?: unknown[], programs: 'ok' | 'down' = 'ok'): Promise<void> {
    const done = store.load();
    await answerLoad(cycles, timelines, programs);
    await done;
  }

  it('shows the active cycle: official apart, sub-timelines in the list', async () => {
    await load([{ id: 1, status: 'closed' }, { id: 2, status: 'active', name: '2027 cycle' }]);
    expect(store.state()).toBe('ready');
    expect(store.official()?.apiId).toBe(1);
    expect(store.subTimelines().map((t) => t.apiId)).toEqual([7]);
  });

  it('no active cycle: says so, no timelines call', async () => {
    await load([{ id: 1, status: 'draft' }]);
    expect(store.state()).toBe('no-cycle');
  });

  it('a catalog down does not block the page; it is flagged', async () => {
    await load([{ id: 2, status: 'active' }], [official], 'down');
    expect(store.state()).toBe('ready');
    expect(store.missingCatalogs()).toEqual(['programs']);
  });

  it('create: the new sub-timeline goes right after the official one', async () => {
    await load([{ id: 2, status: 'active' }]);
    const saved = store.create({ name: 'Sept', programs: [], types: [], steps: [{ name: 'Open', start: '01 Sep 2027', end: '02 Sep 2027', batch: true, audience: 'assessors' }] });
    const req = http.expectOne(`${API}/cycles/2/timelines`);
    expect(req.request.body).toMatchObject({ name: 'Sept', allPrograms: true, allResultTypes: true });
    req.flush(ok(timeline({ id: 8, name: 'Sept' })), { status: 201, statusText: 'Created' });
    expect(await saved).toEqual({ ok: true });
    expect(store.subTimelines().map((t) => t.apiId)).toEqual([8, 7]);
  });

  it('create refused: field problems come back for the drawer, nothing added', async () => {
    await load([{ id: 2, status: 'active' }]);
    const saved = store.create({ name: '', programs: [], types: [], steps: [] });
    http
      .expectOne(`${API}/cycles/2/timelines`)
      .flush(fail(400, 'VALIDATION_FAILED', [{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY', message: 'Too early' }]), { status: 400, statusText: 'Bad' });
    const outcome = await saved;
    expect(outcome).toMatchObject({ ok: false, fields: [{ field: 'steps[0].opensOn' }] });
    expect(store.subTimelines()).toHaveLength(1);
  });

  it('edit asks to confirm a step in progress, then sends confirmInProgress up front', async () => {
    await load([{ id: 2, status: 'active' }]);
    const before = store.subTimelines()[0];
    const draft = { name: 'July', programs: [], types: [], steps: [{ name: 'Open', start: '06 Jul 2027', end: '10 Jul 2027', batch: true }] };
    const first = store.update(before, draft);
    const r1 = http.expectOne(`${API}/timelines/7`);
    expect(r1.request.body).toEqual({ version: 1, steps: [{ position: 1, closesOn: '2027-07-10' }] });
    r1.flush(fail(409, 'TIMELINES_IN_PROGRESS_UNCONFIRMED'), { status: 409, statusText: 'Conflict' });
    expect(await first).toMatchObject({ ok: false, needsConfirm: true });

    const second = store.update(before, draft, true);
    const r2 = http.expectOne(`${API}/timelines/7`);
    expect(r2.request.body).toMatchObject({ confirmInProgress: true });
    r2.flush(ok(timeline({ version: 2 })));
    expect(await second).toEqual({ ok: true });
    expect(store.subTimelines()[0].version).toBe(2);
  });

  it('edit on a stale version reloads in place and never resends', async () => {
    await load([{ id: 2, status: 'active' }]);
    const before = store.subTimelines()[0];
    const saved = store.update(before, { name: 'Renamed', programs: [], types: [], steps: [] });
    http.expectOne(`${API}/timelines/7`).flush(fail(409, 'TIMELINES_VERSION_STALE'), { status: 409, statusText: 'Conflict' });
    await answerLoad([{ id: 2, status: 'active' }], [official, timeline({ version: 5 })]);
    expect(await saved).toMatchObject({ ok: false, stale: true });
    expect(store.subTimelines()[0].version).toBe(5);
    expect(store.state()).toBe('ready');
  });

  it('nothing changed: no call', async () => {
    await load([{ id: 2, status: 'active' }]);
    const before = store.subTimelines()[0];
    const steps = before.steps.map((s) => ({ name: s.name, start: s.start, end: s.end, batch: s.batch }));
    expect(await store.update(before, { name: before.name, programs: [], types: [], steps })).toEqual({ ok: true });
  });
});
