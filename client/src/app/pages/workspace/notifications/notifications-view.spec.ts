import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QaMultiSelect, QaSegmented, QaSelect } from '../../../ui';
import { JULY, TIMELINES } from '../results/results.mock';
import { NotificationsStore } from './notifications-store';
import { NotificationsView } from './notifications-view';

const text = (e: Element): string => (e.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The route's query params; `query.next()` is the router reusing the page with a new query. */
let query: BehaviorSubject<ParamMap>;

/** Renders the page the way the router does: query params from the route, the real store and the real mock behind it. */
async function render(queryParams: Record<string, string> = {}): Promise<ComponentFixture<NotificationsView>> {
  query = new BehaviorSubject(convertToParamMap(queryParams));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: query.asObservable(), snapshot: { queryParamMap: query.value } } },
    ],
  });
  const fixture = TestBed.createComponent(NotificationsView);
  fixture.detectChanges();
  await TestBed.inject(NotificationsStore).load();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const host = (f: ComponentFixture<unknown>): HTMLElement => f.nativeElement;
const rows = (f: ComponentFixture<unknown>): HTMLElement[] => Array.from(host(f).querySelectorAll<HTMLElement>('[data-row]'));
const buttonLabelled = (f: ComponentFixture<unknown>, label: string): HTMLButtonElement | undefined =>
  Array.from(host(f).querySelectorAll('button')).find((b) => text(b) === label || b.getAttribute('aria-label') === label);

/** Drives a control through its own model, as a choice in its menu does. */
async function choose(f: ComponentFixture<unknown>, directive: typeof QaSelect | typeof QaMultiSelect | typeof QaSegmented, value: string | readonly string[]) {
  const cmp = f.debugElement.query(By.directive(directive)).componentInstance as { value: { set(v: unknown): void } };
  cmp.value.set(value);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
}

async function search(f: ComponentFixture<unknown>, query: string) {
  const input = host(f).querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = query;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
}

describe('NotificationsView', () => {
  // jsdom has no ResizeObserver, which spartan's brain primitives (the select menus, the segmented control) read after render.
  beforeEach(() => {
    const noop = (): void => undefined;
    vi.stubGlobal('ResizeObserver', class { observe = noop; unobserve = noop; disconnect = noop; });
  });
  afterEach(() => vi.unstubAllGlobals());

  // (a) FR-6: timeline + type narrow the list, and each applied filter is visible and removable.
  it('(a) lists only the notifications of the chosen timeline and type, each filter a removable chip', async () => {
    const f = await render();
    const all = rows(f).length;
    expect(all).toBeGreaterThanOrEqual(9);

    await choose(f, QaSelect, TIMELINES.find((t) => t.name === JULY)!.id);
    await choose(f, QaMultiSelect, ['Load']);

    const shown = rows(f);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(all);
    for (const row of shown) {
      expect(text(row.querySelector('[data-type]')!)).toBe('Load');
      // The page row shows the resolved timeline name, not an id.
      expect(text(row.querySelector('[data-meta]')!)).toContain(JULY);
    }

    expect(buttonLabelled(f, 'Remove Timeline filter'), 'timeline chip').toBeTruthy();
    expect(buttonLabelled(f, 'Remove Type filter'), 'type chip').toBeTruthy();

    // Removing a chip widens the list again; removing both restores it.
    buttonLabelled(f, 'Remove Type filter')!.click();
    f.detectChanges();
    expect(rows(f).length).toBeGreaterThan(shown.length);
    buttonLabelled(f, 'Remove Timeline filter')!.click();
    f.detectChanges();
    expect(rows(f).length).toBe(all);
    expect(buttonLabelled(f, 'Remove Timeline filter')).toBeUndefined();
  });

  // (b) FR-6: the search covers the sentence, the subject and the timeline, ignoring case.
  it('(b) matches "sp09" with "SP09" in the sentence, the subject or the timeline, ignoring case', async () => {
    const f = await render();
    await search(f, 'sp09');
    const lower = rows(f);
    expect(lower.length).toBeGreaterThan(0);
    for (const row of lower) expect(text(row).toLowerCase()).toContain('sp09');
    expect(lower.some((r) => text(r.querySelector('[data-sentence]')!).includes('SP09'))).toBe(true);

    await search(f, 'SP09');
    expect(rows(f).length).toBe(lower.length);

    // The timeline name is searched too.
    await search(f, 'july 2026');
    expect(rows(f).length).toBeGreaterThan(0);
    for (const row of rows(f)) expect(text(row.querySelector('[data-meta]')!)).toContain(JULY);
  });

  // (c) FR-2: the Unread view shows only unread rows, and the control carries the unread count.
  it('(c) shows only unread rows under Unread, with the grey unread count on the switch', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    const unread = store.unreadCount();
    expect(unread).toBeGreaterThan(0);
    expect(rows(f).length).toBeGreaterThan(unread);

    await choose(f, QaSegmented, 'unread');

    const shown = rows(f);
    expect(shown.length).toBe(unread);
    for (const row of shown) expect(row.querySelector('.sr-only')?.textContent).toBe('Unread');

    const count = host(f).querySelector('qa-segmented span.tabular-nums');
    expect(count, 'grey count').toBeTruthy();
    expect(text(count!)).toBe(String(unread));
  });

  // (d) FR-7: one store feeds the bell, the panel and the page.
  it('(d) "Mark all as read" leaves nothing unread in the store the bell reads, and Unread then shows its empty state', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    expect(store.unreadCount()).toBeGreaterThan(0);

    await choose(f, QaSegmented, 'unread');
    buttonLabelled(f, 'Mark all as read')!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();

    expect(store.unreadCount()).toBe(0);
    expect(rows(f).length).toBe(0);
    expect(text(host(f))).toContain('No unread notifications');

    // A second activation is a no-op: nothing to mark, so the control is inactive and nothing throws.
    expect(buttonLabelled(f, 'Mark all as read')!.disabled).toBe(true);

    // "Show all" leaves the empty Unread view.
    buttonLabelled(f, 'Show all')!.click();
    f.detectChanges();
    expect(rows(f).length).toBeGreaterThanOrEqual(9);
  });

  // (e) FR-8: the states the mock never reaches on its own.
  it('(e) ?mock=loading shows 4 placeholder rows', async () => {
    const f = await render({ mock: 'loading' });
    expect(host(f).querySelectorAll('[data-placeholder]').length).toBe(4);
    expect(rows(f).length).toBe(0);
  });

  it('(e) ?mock=error shows the error, and "Try again" recovers', async () => {
    const f = await render({ mock: 'error' });
    expect(text(host(f).querySelector('[role="alert"]')!)).toContain("Couldn't load notifications.");
    expect(rows(f).length).toBe(0);

    buttonLabelled(f, 'Try again')!.click();
    await f.whenStable();
    f.detectChanges();

    expect(host(f).querySelector('[role="alert"]')).toBeNull();
    expect(rows(f).length).toBeGreaterThanOrEqual(9);
  });

  // (e) Found in T-7: the store is shared and the router reuses the page when only the query changes, so a `?mock=` state
  // must end when the query drops it or the page closes, or the page and the bell stay stuck on it.
  it('(e) dropping ?mock= from the query shows the notifications again', async () => {
    const f = await render({ mock: 'loading' });
    query.next(convertToParamMap({}));
    await f.whenStable();
    f.detectChanges();
    expect(host(f).querySelectorAll('[data-placeholder]').length).toBe(0);
    expect(rows(f).length).toBeGreaterThanOrEqual(9);
  });

  it('(e) closing the page ends its ?mock= state for the bell', async () => {
    const f = await render({ mock: 'error' });
    const store = TestBed.inject(NotificationsStore);
    expect(store.state()).toBe('error');
    f.destroy();
    await Promise.resolve();
    expect(store.state()).toBe('ready');
  });

  // S-4 / FR-9: --text-muted is about 3.0:1 on --surface, under 4.5:1, so no text of the feature uses it. The check reads
  // everything in the document, so it covers the page, the shared selectors' own markup and the menus they open in an overlay.
  describe('(h) --text-muted is absent from the whole document', () => {
    const settle = async (f: ComponentFixture<unknown>) => {
      await f.whenStable();
      await new Promise((r) => setTimeout(r, 30));
      await f.whenStable();
      f.detectChanges();
    };

    const states: readonly { name: string; params: Record<string, string>; timeline?: boolean }[] = [
      { name: 'default', params: {} },
      { name: 'loading', params: { mock: 'loading' } },
      { name: 'error', params: { mock: 'error' } },
      { name: 'a timeline chosen', params: {}, timeline: true },
    ];
    const menus = [
      { name: 'closed', open: null },
      { name: 'timeline menu open', open: 'qa-select button[role="combobox"]' },
      { name: 'Type menu open', open: 'qa-multi-select button' },
    ] as const;

    beforeEach(() => {
      // jsdom has no scrollIntoView (the select calls it on keyboard highlight).
      Element.prototype.scrollIntoView ??= () => undefined;
    });

    for (const state of states) {
      for (const menu of menus) {
        it(`${state.name}, ${menu.name}`, async () => {
          const f = await render(state.params);
          if (state.timeline) {
            await choose(f, QaSelect, TIMELINES.find((t) => t.name === JULY)!.id);
            // The tag next to the chosen timeline is the text this state is about.
            expect(host(f).querySelector('qa-select button[role="combobox"] span.rounded-full'), 'timeline tag').toBeTruthy();
          }
          if (menu.open) {
            host(f).querySelector<HTMLElement>(menu.open)!.click();
            await settle(f);
            // The panel mounted outside the component, in the overlay: its group headings, search placeholder and options.
            const isSelect = menu.open.startsWith('qa-select');
            expect(document.querySelector(isSelect ? '[role="listbox"]' : '[role="dialog"]'), 'open panel').toBeTruthy();
            if (isSelect) expect(document.body.textContent).toContain('Sub-timelines');
          }

          expect(document.body.innerHTML).not.toContain('--text-muted');
          // The search input keeps the AA placeholder token.
          expect(host(f).querySelector<HTMLInputElement>('input[type="text"]')!.className).toContain('placeholder:text-(--text-4)');
        });
      }
    }
  });

  // FR-8: filters that match nothing, and the way out.
  it('says so when the filters match nothing, and "Clear filters" brings the list back', async () => {
    const f = await render();
    const all = rows(f).length;
    await search(f, 'zzz-no-such-notification');
    expect(rows(f).length).toBe(0);
    expect(text(host(f))).toContain('No notifications match these filters');

    buttonLabelled(f, 'Clear filters')!.click();
    f.detectChanges();
    expect(rows(f).length).toBe(all);
    expect(host(f).querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('');
  });

  // FR-7 + DD-11: opening a row reads it and goes to its target, reloading even on the same URL.
  it('opening a row marks it read and navigates to its target with a same-URL reload', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const before = store.unreadCount();
    const first = store.items().find((n) => n.unread)!;
    const row = rows(f).find((r) => text(r.querySelector('[data-sentence]')!) === `${first.subject} ${first.text}`)!;

    row.querySelector<HTMLButtonElement>('button')!.click();

    expect(store.unreadCount()).toBe(before - 1);
    expect(navigate).toHaveBeenCalledWith([first.target.path], expect.objectContaining({ queryParams: first.target.queryParams, onSameUrlNavigation: 'reload' }));
  });
});
