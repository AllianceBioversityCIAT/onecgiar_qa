import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { Toasts } from '../../../core/http/toasts';
import { FieldsStore } from './fields-store';

const API = 'https://api.test/api/v1';
const FC = `${API}/cycles/34/field-config`;
const meta = { requestId: 'r', timestamp: 't' };
const ok = (data: unknown) => ({ success: true, data, meta });
const fail = (status: number, code: string, fields: unknown[] = []) => ({
  success: false,
  error: { status, code, message: `server says ${code}`, fields },
  meta,
});

const hidden = { visibility: 'hidden', isCore: false, isAiInput: false };
const assessed = { visibility: 'assessed', isCore: true, isAiInput: false };
const field = (key: string, draft = hidden, published: unknown = hidden) => ({
  key,
  label: key,
  requirement: 'optional',
  isNew: false,
  unclassified: false,
  draft,
  published,
});
const view = (revision: number, title = hidden) => ({
  cycleId: 34,
  year: 2026,
  catalogVersion: '2026.30',
  revision,
  latestVersion: { number: 1, publishedAt: '2026-10-26T21:20:51Z' },
  resultTypes: [
    { key: 'policy_change', label: 'Policy change', level: 'outcome', sections: [{ key: 'general', label: 'General', fields: [field('title', title), field('year')] }] },
  ],
  notInCatalog: [],
});
const cycles = [
  { id: 21, year: 2084, name: '2084 cycle', status: 'active' },
  { id: 34, year: 2026, name: '2026 cycle', status: 'draft' },
  { id: 2, year: 2098, name: '2098 cycle', status: 'closed' },
];
const preview = (revision: number) => ({
  revision,
  basedOn: 1,
  changes: [{ resultTypeKey: 'policy_change', fieldKey: 'title', before: hidden, after: assessed }],
  timelines: { receive: [{ id: 5, name: 'July', opensOn: '2027-07-06' }], keep: [] },
});

describe('FieldsStore', () => {
  let http: HttpTestingController;
  let store: FieldsStore;
  const toasts = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        FieldsStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Toasts, useValue: toasts },
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(FieldsStore);
  });
  afterEach(() => http.verify());

  const tick = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** Loads cycle 34 (cycle 21 has no catalog). */
  async function ready(revision = 2): Promise<void> {
    const done = store.load();
    http.expectOne(`${API}/cycles`).flush(ok(cycles));
    await tick();
    http.expectOne(`${API}/cycles/21/field-config`).flush(fail(409, 'FIELD_CONFIG_CATALOG_MISSING'), { status: 409, statusText: 'Conflict' });
    await done;
    expect(store.state()).toBe('no-catalog');
    const select = store.selectCycle(34);
    await tick();
    http.expectOne(FC).flush(ok(view(revision)));
    await select;
  }

  it('picks the active cycle, lists only open cycles, and shows "no catalog" on 409', async () => {
    await ready();
    expect(store.cycles().map((c) => c.id)).toEqual([21, 34]);
    expect(store.state()).toBe('ready');
    expect(store.view()?.revision).toBe(2);
  });

  it('shows a click at once and sends clicks made during a save together in one PATCH', async () => {
    await ready();
    store.edit('policy_change', 'title', { state: 'assessed', core: true, ai: false });
    expect(store.configOf('policy_change', 'title', { state: 'hidden', core: false, ai: false }).state).toBe('assessed');
    const first = http.expectOne(`${FC}/draft`);
    expect(first.request.body).toEqual({
      items: [{ resultTypeKey: 'policy_change', fieldKey: 'title', visibility: 'assessed', isCore: true, isAiInput: false }],
    });

    // Two more clicks while the first save is in flight.
    store.edit('policy_change', 'year', { state: 'view_only', core: true, ai: true });
    store.edit('policy_change', 'title', { state: 'assessed', core: false, ai: false });
    first.flush(ok(view(3, assessed)));
    await tick();

    const second = http.expectOne(`${FC}/draft`);
    // Flags travel only with assessed (S-14): the view only field sends them off.
    expect(second.request.body.items).toEqual([
      { resultTypeKey: 'policy_change', fieldKey: 'year', visibility: 'view_only', isCore: false, isAiInput: false },
      { resultTypeKey: 'policy_change', fieldKey: 'title', visibility: 'assessed', isCore: false, isAiInput: false },
    ]);
    // The newer click on title is still shown over the first answer.
    expect(store.configOf('policy_change', 'title', { state: 'assessed', core: true, ai: false }).core).toBe(false);
    second.flush(ok(view(4)));
    await store.settle();
    expect(store.hasOverride('policy_change', 'title')).toBe(false);
    expect(store.view()?.revision).toBe(4);
  });

  it('a refused edit drops the click, reloads the draft and says why', async () => {
    await ready();
    store.edit('policy_change', 'title', { state: 'assessed', core: true, ai: false });
    http
      .expectOne(`${FC}/draft`)
      .flush(fail(400, 'VALIDATION_FAILED', [{ field: 'items[0].isCore', code: 'NOT_ASSESSED', message: 'Core needs an assessed field.' }]), {
        status: 400,
        statusText: 'Bad Request',
      });
    await tick();
    http.expectOne(FC).flush(ok(view(2)));
    await store.settle();
    expect(store.hasOverride('policy_change', 'title')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Core needs an assessed field.');
  });

  it('publishes the reviewed revision and reloads the draft', async () => {
    await ready();
    const opening = store.openReview();
    await tick();
    http.expectOne(`${FC}/publish-preview`).flush(ok(preview(2)));
    expect(await opening).toBe(true);

    const publishing = store.publish();
    const req = http.expectOne(`${FC}/publish`);
    expect(req.request.body).toEqual({ revision: 2 });
    expect(req.request.method).toBe('POST');
    req.flush(ok({ version: { number: 2, publishedAt: 'x', catalogVersion: '2026.30' }, timelines: { receive: [{ id: 5, name: 'July', opensOn: null }], keep: [] } }), {
      status: 201,
      statusText: 'Created',
    });
    await tick();
    http.expectOne(FC).flush(ok(view(3)));
    expect(await publishing).toBe(true);
    expect(store.review()).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Version 2 published. 1 timeline will use it.');
  });

  it('on a stale draft reloads the view and the preview and keeps the review open with a notice', async () => {
    await ready();
    const opening = store.openReview();
    await tick();
    http.expectOne(`${FC}/publish-preview`).flush(ok(preview(2)));
    await opening;

    const publishing = store.publish();
    http.expectOne(`${FC}/publish`).flush(fail(409, 'FIELD_CONFIG_REVISION_STALE'), { status: 409, statusText: 'Conflict' });
    await tick();
    http.expectOne(FC).flush(ok(view(5)));
    await tick();
    http.expectOne(`${FC}/publish-preview`).flush(ok(preview(5)));
    expect(await publishing).toBe(false);
    expect(store.review()?.preview.revision).toBe(5);
    expect(store.review()?.notice).toContain('The draft changed');
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('discard asks the server for the published draft and drops pending clicks', async () => {
    await ready();
    const discarding = store.discard();
    await tick();
    const req = http.expectOne(`${FC}/draft`);
    expect(req.request.method).toBe('DELETE');
    req.flush(ok(view(6)));
    expect(await discarding).toBe(true);
    expect(store.view()?.revision).toBe(6);
  });

  it('a closed cycle takes no edits', async () => {
    await ready();
    store.cycle.set({ ...store.cycle()!, status: 'closed' });
    store.edit('policy_change', 'title', { state: 'assessed', core: false, ai: false });
    http.expectNone(`${FC}/draft`);
    expect(store.hasOverride('policy_change', 'title')).toBe(false);
  });

  it('switching cycle clears the previous cycle at once', async () => {
    await ready();
    store.edit('policy_change', 'title', { state: 'assessed', core: false, ai: false });
    http.expectOne(`${FC}/draft`).flush(ok(view(3)));
    await store.settle();
    const switching = store.selectCycle(21);
    await tick();
    expect(store.view()).toBeNull();
    expect(store.state()).toBe('loading');
    http.expectOne(`${API}/cycles/21/field-config`).flush(fail(409, 'FIELD_CONFIG_CATALOG_MISSING'), { status: 409, statusText: 'Conflict' });
    await switching;
    expect(store.state()).toBe('no-catalog');
  });

  it('an edit that cannot reach the server is reverted and told, never left to replay later', async () => {
    await ready();
    store.edit('policy_change', 'title', { state: 'assessed', core: false, ai: false });
    http.expectOne(`${FC}/draft`).flush(fail(503, 'SERVICE_UNAVAILABLE'), { status: 503, statusText: 'Unavailable' });
    await tick();
    http.expectOne(FC).flush(ok(view(2)));
    await store.settle();
    expect(store.hasOverride('policy_change', 'title')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('server says SERVICE_UNAVAILABLE');
  });

  it('the review cannot be closed while a publish is running', async () => {
    await ready();
    const opening = store.openReview();
    await tick();
    http.expectOne(`${FC}/publish-preview`).flush(ok(preview(2)));
    await opening;
    const publishing = store.publish();
    store.closeReview();
    expect(store.review()).not.toBeNull();
    http.expectOne(`${FC}/publish`).flush(fail(409, 'FIELD_CONFIG_NOTHING_TO_PUBLISH'), { status: 409, statusText: 'Conflict' });
    await tick();
    http.expectOne(FC).flush(ok(view(2)));
    await tick();
    http.expectOne(`${FC}/publish-preview`).flush(ok({ ...preview(2), changes: [] }));
    await publishing;
    expect(store.review()?.notice).toContain('nothing new to publish');
  });
});
