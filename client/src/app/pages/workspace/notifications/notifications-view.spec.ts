import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TIMELINES } from '../results/results.mock';
import { NotificationsStore } from './notifications-store';
import { NotificationsView } from './notifications-view';
import { sentenceText, type Notification } from './notifications.model';

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

describe('NotificationsView', () => {
  // One admin gets few notifications: one list, no tabs, no filters and no "Mark all as read" (Juanpa, 2026-10-29).
  it('shows every notification in one list, newest first, with no tabs, filters or "Mark all as read"', async () => {
    const f = await render();
    const items = TestBed.inject(NotificationsStore).items();

    expect(rows(f).map(sentenceOf)).toEqual(items.map(sentenceText));
    expect(host(f).querySelector('[role="tablist"]'), 'tabs').toBeNull();
    expect(host(f).querySelector('qa-select, qa-multi-select'), 'filter menus').toBeNull();
    expect(host(f).querySelector('input'), 'search').toBeNull();
    expect(buttonLabelled(host(f), 'Mark all as read'), 'Mark all as read').toBeUndefined();
    expect(Array.from(host(f).querySelectorAll('[data-group]')).map((g) => text(g).replace(/[\s,\d].*$/, ''))).toEqual(['Today', 'Yesterday', 'Earlier']);
  });

  it('every notification carries its own button and "Not now" in its row', async () => {
    const f = await render();
    const store = TestBed.inject(NotificationsStore);
    expect(host(f).querySelectorAll('[data-row] .sr-only').length).toBe(store.unreadCount());
    for (const n of store.items()) {
      const row = rowOf(f, n);
      expect(row.dataset['category'], n.id).toBe('action');
      expect(buttonLabelled(row, n.action!), n.id).toBeTruthy();
      expect(buttonLabelled(row, 'Not now'), n.id).toBeTruthy();
    }
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
      const n = find('Slow program', true);
      const before = store.unreadCount();
      buttonLabelled(rowOf(f, n), 'Not now')!.click();
      await settle(f);
      expect(store.unreadCount()).toBe(before - 1);
      expect(navigate).not.toHaveBeenCalled();
      expect(rowOf(f, n).querySelector('.sr-only')).toBeNull();
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
    expect(rows(f).length).toBe(TestBed.inject(NotificationsStore).items().length);
  });

  // The store is shared and the router reuses the page when only the query changes, so a `?mock=` state must end when
  // the query drops it or the page closes, or the page and the bell stay stuck on it.
  it('dropping ?mock= from the query shows the notifications again', async () => {
    const f = await render({ mock: 'loading' });
    query.next(convertToParamMap({}));
    await settle(f);
    expect(host(f).querySelectorAll('[data-placeholder]').length).toBe(0);
    expect(rows(f).length).toBe(TestBed.inject(NotificationsStore).items().length);
  });

  it('closing the page ends its ?mock= state for the bell', async () => {
    const f = await render({ mock: 'error' });
    const store = TestBed.inject(NotificationsStore);
    expect(store.state()).toBe('error');
    f.destroy();
    await Promise.resolve();
    expect(store.state()).toBe('ready');
  });

  // --text-muted is about 3.0:1 on --surface, under 4.5:1, so no text of the page uses it.
  const states: readonly { name: string; params: Record<string, string> }[] = [
    { name: 'default', params: {} },
    { name: 'loading', params: { mock: 'loading' } },
    { name: 'error', params: { mock: 'error' } },
  ];
  for (const state of states) {
    it(`--text-muted is absent from the page (${state.name})`, async () => {
      const f = await render(state.params);
      expect(host(f).innerHTML).not.toContain('--text-muted');
    });
  }
});
