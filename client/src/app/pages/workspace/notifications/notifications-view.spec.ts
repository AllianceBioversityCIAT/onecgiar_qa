import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { QaMultiSelect, QaSelect } from '../../../ui';
import { ANNUAL, JULY, TIMELINES } from '../results/results.mock';
import { NotificationsStore } from './notifications-store';
import { NotificationsView } from './notifications-view';
import { NOTIFICATION_CATEGORY, sentenceText, type Notification } from './notifications.model';

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
  await settle(fixture);
  return fixture;
}

async function settle(f: ComponentFixture<unknown>): Promise<void> {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
}

const host = (f: ComponentFixture<unknown>): HTMLElement => f.nativeElement;
const rows = (f: ComponentFixture<unknown>): HTMLElement[] => Array.from(host(f).querySelectorAll<HTMLElement>('[data-row]'));
const sentenceOf = (row: HTMLElement): string => text(row.querySelector('[data-sentence]')!);
const rowOf = (f: ComponentFixture<unknown>, n: Notification): HTMLElement => rows(f).find((r) => sentenceOf(r) === sentenceText(n))!;
const buttonLabelled = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  Array.from(root.querySelectorAll('button')).find((b) => text(b) === label || b.getAttribute('aria-label') === label);
const tabs = (f: ComponentFixture<unknown>): HTMLButtonElement[] => Array.from(host(f).querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const tabCounts = (f: ComponentFixture<unknown>): number[] => tabs(f).map((t) => Number(text(t.querySelector('[data-tab-count]')!)));

async function openTab(f: ComponentFixture<unknown>, label: string): Promise<void> {
  tabs(f)
    .find((t) => text(t).startsWith(label))!
    .click();
  await settle(f);
}

/** Drives a control through its own model, as a choice in its menu does. Multi-selects are found by their label. */
async function choose(f: ComponentFixture<unknown>, control: 'Viewing' | 'Type' | 'Science program', value: string | readonly string[]) {
  const debug =
    control === 'Viewing'
      ? f.debugElement.query(By.directive(QaSelect))
      : f.debugElement.queryAll(By.directive(QaMultiSelect)).find((d) => (d.componentInstance as QaMultiSelect).label() === control)!;
  (debug.componentInstance as { value: { set(v: unknown): void } }).value.set(value);
  await settle(f);
}

async function search(f: ComponentFixture<unknown>, value: string) {
  const input = host(f).querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(f);
}

describe('NotificationsView', () => {
  // jsdom has no ResizeObserver, which spartan's brain primitives (the select menus, the tabs) read after render.
  beforeEach(() => {
    const noop = (): void => undefined;
    vi.stubGlobal('ResizeObserver', class { observe = noop; unobserve = noop; disconnect = noop; });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has three real tabs with their counts, All selected first', async () => {
    const f = await render();
    const items = TestBed.inject(NotificationsStore).items();
    const action = items.filter((n) => NOTIFICATION_CATEGORY[n.type] === 'action').length;

    expect(host(f).querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Notifications');
    expect(tabs(f).map((t) => text(t).replace(/\s*\d+$/, ''))).toEqual(['All', 'Needs your action', 'For your information']);
    expect(tabCounts(f)).toEqual([items.length, action, items.length - action]);
    expect(tabs(f).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(rows(f).length).toBe(items.length);
    // The visible panel is labelled by the selected tab.
    const panel = host(f).querySelector('[role="tabpanel"]:not([hidden])')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs(f)[0].id);
  });

  it('"Needs your action" lists only rows with buttons, "For your information" only the updates', async () => {
    const f = await render();
    await openTab(f, 'Needs your action');
    expect(tabs(f)[1].getAttribute('aria-selected')).toBe('true');
    expect(rows(f).length).toBe(tabCounts(f)[1]);
    for (const row of rows(f)) {
      expect(row.dataset['category']).toBe('action');
      expect(buttonLabelled(row, 'Not now'), sentenceOf(row)).toBeTruthy();
    }

    await openTab(f, 'For your information');
    expect(rows(f).length).toBe(tabCounts(f)[2]);
    for (const row of rows(f)) expect(row.dataset['category']).toBe('info');
  });

  it('the tab counts follow the timeline, type, program and search filters', async () => {
    const f = await render();
    const [all] = tabCounts(f);

    await choose(f, 'Viewing', TIMELINES.find((t) => t.name === ANNUAL)!.id);
    let counts = tabCounts(f);
    expect(counts[0]).toBeLessThan(all);
    expect(counts[1] + counts[2]).toBe(counts[0]);
    expect(rows(f).length).toBe(counts[0]);
    for (const row of rows(f)) expect(text(row)).toContain(ANNUAL);

    await choose(f, 'Viewing', 'all');
    await choose(f, 'Type', ['At risk', 'Stage']);
    counts = tabCounts(f);
    const store = TestBed.inject(NotificationsStore);
    expect(counts).toEqual([
      store.items().filter((n) => n.type === 'At risk' || n.type === 'Stage').length,
      store.items().filter((n) => n.type === 'At risk').length,
      store.items().filter((n) => n.type === 'Stage').length,
    ]);
  });

  it('the Type menu lists only the types of the current tab, and changing tab drops a type it does not list', async () => {
    const f = await render();
    const options = () => (f.debugElement.queryAll(By.directive(QaMultiSelect)).find((d) => (d.componentInstance as QaMultiSelect).label() === 'Type')!.componentInstance as QaMultiSelect).options().map((o) => o.value);
    expect(options().length).toBe(8);

    await choose(f, 'Type', ['Stage', 'At risk']);
    await openTab(f, 'Needs your action');
    expect(options()).toEqual(['Step complete', 'Slow program', 'At risk']);
    // "Stage" is not in this tab: it is dropped, so the chip shows only what the menu can show.
    expect(text(host(f).querySelector('[data-row] [data-type]')!)).toBe('At risk');
    expect(rows(f).length).toBe(1);
    const chip = Array.from(host(f).querySelectorAll('span.bg-\\(--tint\\)')).find((c) => text(c).startsWith('Type'))!;
    expect(text(chip.querySelector('.truncate')!)).toBe('At risk');
  });

  it('the Science program filter keeps only the notifications about the chosen programs, as a removable chip', async () => {
    const f = await render();
    const all = rows(f).length;
    await choose(f, 'Science program', ['SP09']);
    const shown = rows(f);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(all);
    for (const row of shown) expect(sentenceOf(row)).toContain('SP09');

    buttonLabelled(host(f), 'Remove Science program filter')!.click();
    await settle(f);
    expect(rows(f).length).toBe(all);
  });

  it('matches "sp12" with "SP12" in the sentence, ignoring case, and searches the timeline name too', async () => {
    const f = await render();
    await search(f, 'sp12');
    const lower = rows(f);
    expect(lower.length).toBeGreaterThan(0);
    for (const row of lower) expect(text(row).toLowerCase()).toContain('sp12');
    await search(f, 'SP12');
    expect(rows(f).length).toBe(lower.length);

    await search(f, 'july 2026');
    expect(rows(f).length).toBeGreaterThan(0);
    for (const row of rows(f)) expect(text(row)).toContain(JULY);
  });

  it('shows each applied filter as a chip, and "Clear all" clears them and the search', async () => {
    const f = await render();
    const all = rows(f).length;
    await choose(f, 'Viewing', TIMELINES.find((t) => t.name === JULY)!.id);
    await choose(f, 'Type', ['Escalation']);
    await choose(f, 'Science program', ['SP02']);
    expect(buttonLabelled(host(f), 'Remove Timeline filter')).toBeTruthy();
    expect(buttonLabelled(host(f), 'Remove Type filter')).toBeTruthy();
    expect(buttonLabelled(host(f), 'Remove Science program filter')).toBeTruthy();
    expect(rows(f).length).toBe(1);

    buttonLabelled(host(f), 'Clear all')!.click();
    await settle(f);
    expect(rows(f).length).toBe(all);
    expect(buttonLabelled(host(f), 'Clear all')).toBeUndefined();
  });

  it('says so when the filters match nothing, and "Clear filters" brings the list back', async () => {
    const f = await render();
    const all = rows(f).length;
    await search(f, 'zzz-no-such-notification');
    expect(rows(f).length).toBe(0);
    expect(tabCounts(f)).toEqual([0, 0, 0]);
    expect(text(host(f))).toContain('No notifications match these filters');

    buttonLabelled(host(f), 'Clear filters')!.click();
    await settle(f);
    expect(rows(f).length).toBe(all);
    expect(host(f).querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('');
  });

  it('"Mark all as read" leaves nothing unread in the store the bell reads, then goes away', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    expect(store.unreadCount()).toBeGreaterThan(0);
    expect(host(f).querySelectorAll('[data-row] .sr-only').length).toBe(store.unreadCount());

    buttonLabelled(host(f), 'Mark all as read')!.click();
    await settle(f);

    expect(store.unreadCount()).toBe(0);
    expect(Array.from(host(f).querySelectorAll('[data-row] .sr-only')).filter((e) => e.textContent === 'Unread').length).toBe(0);
    expect(buttonLabelled(host(f), 'Mark all as read')).toBeUndefined();
  });

  describe('row actions', () => {
    const find = (type: string, unread?: boolean) =>
      TestBed.inject(NotificationsStore)
        .items()
        .find((n) => n.type === type && (unread === undefined || n.unread === unread))!;

    async function withNavigate() {
      const f = await render();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      return { f, navigate, store: TestBed.inject(NotificationsStore) };
    }

    it('"Open next step" on a Step complete marks it read and opens Cycle', async () => {
      const { f, navigate, store } = await withNavigate();
      const n = find('Step complete', true);
      buttonLabelled(rowOf(f, n), 'Open next step')!.click();
      expect(store.items().find((x) => x.id === n.id)!.unread).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/cycle'], expect.objectContaining({ onSameUrlNavigation: 'reload' }));
    });

    it('"View results" on a Slow program opens Results for that program, timeline and Awaiting response', async () => {
      const { f, navigate, store } = await withNavigate();
      const n = find('Slow program', true);
      buttonLabelled(rowOf(f, n), 'View results')!.click();
      expect(store.items().find((x) => x.id === n.id)!.unread).toBe(false);
      expect(navigate).toHaveBeenCalledWith(
        ['/results'],
        expect.objectContaining({ queryParams: { timeline: n.timelineId, program: n.program, status: 'Awaiting response' }, onSameUrlNavigation: 'reload' }),
      );
    });

    it('"Not now" only marks it read and stays on the page', async () => {
      const { f, navigate, store } = await withNavigate();
      const n = find('At risk', true);
      const before = store.unreadCount();
      buttonLabelled(rowOf(f, n), 'Not now')!.click();
      await settle(f);
      expect(store.unreadCount()).toBe(before - 1);
      expect(navigate).not.toHaveBeenCalled();
      expect(rowOf(f, n).querySelector('.sr-only')).toBeNull();
    });

    it('clicking an update row marks it read and opens its target', async () => {
      const { f, navigate, store } = await withNavigate();
      const n = find('Escalation', true);
      rowOf(f, n).click();
      expect(store.items().find((x) => x.id === n.id)!.unread).toBe(false);
      expect(navigate).toHaveBeenCalledWith([n.target.path], expect.objectContaining({ queryParams: n.target.queryParams, onSameUrlNavigation: 'reload' }));
    });
  });

  it('shows the batch pill of each row: Main batch, Complementary batch or All batches', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    for (const n of store.items()) {
      const kind = TIMELINES.find((t) => t.id === n.timelineId)?.kind;
      const expected = n.timelineId === 'all' ? 'All batches' : kind === 'Official timeline' ? 'Main batch' : 'Complementary batch';
      expect(text(rowOf(f, n).querySelector('[data-batch]')!), n.id).toBe(expected);
    }
  });

  // FR-8: the states the mock never reaches on its own.
  it('?mock=loading shows 4 placeholder rows', async () => {
    const f = await render({ mock: 'loading' });
    expect(host(f).querySelectorAll('[data-placeholder]').length).toBe(4);
    expect(rows(f).length).toBe(0);
  });

  it('?mock=error shows the error, and "Try again" recovers', async () => {
    const f = await render({ mock: 'error' });
    expect(text(host(f).querySelector('[role="alert"]')!)).toContain("Couldn't load notifications.");
    expect(rows(f).length).toBe(0);

    buttonLabelled(host(f), 'Try again')!.click();
    await settle(f);

    expect(host(f).querySelector('[role="alert"]')).toBeNull();
    expect(rows(f).length).toBe(14);
  });

  // The store is shared and the router reuses the page when only the query changes, so a `?mock=` state must end when
  // the query drops it or the page closes, or the page and the bell stay stuck on it.
  it('dropping ?mock= from the query shows the notifications again', async () => {
    const f = await render({ mock: 'loading' });
    query.next(convertToParamMap({}));
    await settle(f);
    expect(host(f).querySelectorAll('[data-placeholder]').length).toBe(0);
    expect(rows(f).length).toBe(14);
  });

  it('closing the page ends its ?mock= state for the bell', async () => {
    const f = await render({ mock: 'error' });
    const store = TestBed.inject(NotificationsStore);
    expect(store.state()).toBe('error');
    f.destroy();
    await Promise.resolve();
    expect(store.state()).toBe('ready');
  });

  // --text-muted is about 3.0:1 on --surface, under 4.5:1, so no text of the feature uses it. The check reads everything in
  // the document, so it covers the page, the shared selectors' and tabs' own markup and the menus they open in an overlay.
  describe('--text-muted is absent from the whole document', () => {
    const settleMenu = async (f: ComponentFixture<unknown>) => {
      await f.whenStable();
      await new Promise((r) => setTimeout(r, 30));
      await settle(f);
    };

    const states: readonly { name: string; params: Record<string, string>; timeline?: boolean; tab?: string }[] = [
      { name: 'default', params: {} },
      { name: 'loading', params: { mock: 'loading' } },
      { name: 'error', params: { mock: 'error' } },
      { name: 'a timeline chosen', params: {}, timeline: true },
      { name: 'Needs your action', params: {}, tab: 'Needs your action' },
    ];
    const menus = [
      { name: 'closed', open: null },
      { name: 'timeline menu open', open: 'qa-select button[role="combobox"]' },
      { name: 'Type menu open', open: 'qa-multi-select[label="Type"] button' },
      { name: 'Science program menu open', open: 'qa-multi-select[label="Science program"] button' },
    ] as const;

    beforeEach(() => {
      // jsdom has no scrollIntoView (the select calls it on keyboard highlight).
      Element.prototype.scrollIntoView ??= () => undefined;
    });

    for (const state of states) {
      for (const menu of menus) {
        it(`${state.name}, ${menu.name}`, async () => {
          const f = await render(state.params);
          if (state.tab) await openTab(f, state.tab);
          if (state.timeline) {
            await choose(f, 'Viewing', TIMELINES.find((t) => t.name === ANNUAL)!.id);
            // The tag next to the chosen timeline ("Main", only the main batch has one) is the text this state is about.
            expect(host(f).querySelector('qa-select button[role="combobox"] span.rounded-full'), 'timeline tag').toBeTruthy();
          }
          if (menu.open) {
            host(f).querySelector<HTMLElement>(menu.open)!.click();
            await settleMenu(f);
            // The panel mounted outside the component, in the overlay: its group headings, search placeholder and options.
            const isSelect = menu.open.startsWith('qa-select');
            expect(document.querySelector(isSelect ? '[role="listbox"]' : '[role="dialog"]'), 'open panel').toBeTruthy();
            if (isSelect) expect(document.body.textContent).toContain('Complementary batches');
          }

          expect(document.body.innerHTML).not.toContain('--text-muted');
          // The search input keeps the AA placeholder token.
          expect(host(f).querySelector<HTMLInputElement>('input[type="text"]')!.className).toContain('placeholder:text-(--text-4)');
        });
      }
    }
  });
});
