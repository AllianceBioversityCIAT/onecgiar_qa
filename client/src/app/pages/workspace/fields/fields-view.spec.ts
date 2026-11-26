import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { Toasts } from '../../../core/http/toasts';
import { FieldsView } from './fields-view';

const API = 'https://api.test/api/v1';
const FC = `${API}/cycles/34/field-config`;
const meta = { requestId: 'r', timestamp: 't' };
const ok = (data: unknown) => ({ success: true, data, meta });

const hidden = { visibility: 'hidden', isCore: false, isAiInput: false };
const assessed = { visibility: 'assessed', isCore: false, isAiInput: false };
const assessedAi = { visibility: 'assessed', isCore: false, isAiInput: true };
const field = (key: string, draft: unknown, published: unknown) => ({
  key,
  label: key,
  requirement: 'optional',
  isNew: false,
  unclassified: false,
  draft,
  published,
});
const view = (title: { draft: unknown; published: unknown }) => ({
  cycleId: 34,
  year: 2026,
  catalogVersion: '2026.30',
  revision: 2,
  latestVersion: { number: 1, publishedAt: '2026-10-26T21:20:51Z' },
  resultTypes: [
    {
      key: 'policy_change',
      label: 'Policy change',
      level: 'outcome',
      sections: [{ key: 'general', label: 'General', fields: [field('title', title.draft, title.published), field('year', hidden, hidden)] }],
    },
  ],
  notInCatalog: [],
});

/** F-021: the AI input column is back in Fields (Ángel + Juanda, 25-nov-2026). */
describe('FieldsView — AI input column (F-021)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Toasts, useValue: { error: vi.fn(), success: vi.fn(), info: vi.fn() } },
        { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: API, ssoCallbackPath: '/auth/callback' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await fixture.whenStable();
  };

  async function render(title: { draft: unknown; published: unknown }) {
    const fixture = TestBed.createComponent(FieldsView);
    fixture.autoDetectChanges();
    http.expectOne(`${API}/cycles`).flush(ok([{ id: 34, year: 2026, name: '2026 cycle', status: 'active' }]));
    await settle(fixture);
    http.expectOne(FC).flush(ok(view(title)));
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  const switchOf = (host: HTMLElement, label: string) => host.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);

  it('shows an AI switch on each assessed field, on only for a field stored with AI input; elsewhere it does not apply', async () => {
    const host = await render({ draft: assessedAi, published: assessedAi });
    const ai = switchOf(host, 'AI helper: title');
    expect(ai).not.toBeNull();
    expect(ai!.getAttribute('aria-checked')).toBe('true');
    // A field that is not Assessed shows a dash instead of a switch (2026-11-25), so "off" and "does not apply" differ.
    expect(switchOf(host, 'AI helper: year')).toBeNull();
    expect(host.textContent).toContain('AI helper does not apply');
  });

  it('turning AI on sends isAiInput true in the draft PATCH, like the Core switch', async () => {
    const host = await render({ draft: assessed, published: assessed });
    switchOf(host, 'AI helper: title')!.click();
    const req = http.expectOne(`${FC}/draft`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      items: [{ resultTypeKey: 'policy_change', fieldKey: 'title', visibility: 'assessed', isCore: false, isAiInput: true }],
    });
    req.flush(ok(view({ draft: assessedAi, published: assessed })));
  });

  it('another edit keeps the AI value of the draft, not the published one', async () => {
    const host = await render({ draft: assessedAi, published: assessed });
    switchOf(host, 'Core: title')!.click();
    const req = http.expectOne(`${FC}/draft`);
    expect(req.request.body.items[0]).toEqual(expect.objectContaining({ isCore: true, isAiInput: true }));
    req.flush(ok(view({ draft: { ...assessedAi, isCore: true }, published: assessed })));
  });

  it('two fast taps on AI send one PATCH at a time', async () => {
    const host = await render({ draft: assessed, published: assessed });
    const ai = switchOf(host, 'AI helper: title')!;
    ai.click();
    ai.click();
    const first = http.match(`${FC}/draft`);
    expect(first.length).toBe(1);
    first[0].flush(ok(view({ draft: assessedAi, published: assessed })));
    await settle({ whenStable: () => Promise.resolve() });
    for (const r of http.match(`${FC}/draft`)) r.flush(ok(view({ draft: assessed, published: assessed })));
  });
});
