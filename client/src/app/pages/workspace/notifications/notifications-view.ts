import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaMultiSelect, QaSegmented, QaSegmentedOption, QaSelectImports, QaSelectOption } from '../../../ui';
import { TIMELINES } from '../results/results.mock';
import { NotificationList } from './notification-list';
import { NotificationsStore } from './notifications-store';
import { NOTIFICATION_TYPES, type Notification, type NotificationsLoadState } from './notifications.model';

type FilterKey = 'timeline' | 'type';

/** Under this width (Tailwind's `sm`) the All / Unread switch takes the full row so its segments reach a 40 px target. */
const NARROW_QUERY = '(max-width: 639.98px)';

/** The states the mock never reaches on its own, reachable with `?mock=` (design DD-9). Removed with the mock. */
const MOCK_STATES: readonly NotificationsLoadState[] = ['loading', 'error'];

/**
 * Notifications: the updates on the review of results, for the QA Admin. The page only reads the store (the one source
 * the bell and the panel read too) and filters what it shows by timeline, type, search and read state.
 * `?mock=loading|error` shows the loading or error state while the data is a mock. The store is shared and the router
 * reuses this view when only the query changes, so the switch follows every query change and ends when the page closes.
 */
@Component({
  selector: 'qa-notifications-view',
  templateUrl: './notifications-view.html',
  imports: [QaButtonImports, HlmInput, QaSelectImports, QaMultiSelect, QaSegmented, NotificationList],
})
export class NotificationsView {
  protected readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** True while this page shows a `?mock=` state. */
  private simulating = false;

  // ---------- Filters ----------
  /** "All timelines", then the official timeline and the sub-timelines (same order and groups as Results). */
  protected readonly timelineOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines' },
    ...[...TIMELINES]
      .sort((a, b) => Number(a.kind !== 'Official timeline') - Number(b.kind !== 'Official timeline'))
      .map((t) => ({
        value: t.id,
        label: t.name,
        group: t.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timelines',
        tag: t.kind === 'Official timeline' ? 'Official' : 'Sub',
      })),
  ];
  /** Timeline names by id, for the rows (the list and its rows read no mock). `all` is "All timelines". */
  protected readonly timelineNames: Readonly<Record<string, string>> = Object.fromEntries([
    ['all', 'All timelines'],
    ...TIMELINES.map((t) => [t.id, t.name]),
  ]);
  protected readonly typeOptions = NOTIFICATION_TYPES.map((t) => ({ value: t, label: t }));

  protected readonly timelineId = signal('all');
  protected readonly types = signal<readonly string[]>([]);
  protected readonly search = signal('');
  protected readonly view = signal<'all' | 'unread'>('all');

  /** Under 640 px; false where there is no `matchMedia` (server rendering, tests). */
  protected readonly narrow = signal(false);

  protected readonly viewOptions = computed<readonly QaSegmentedOption[]>(() => [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread', count: this.store.unreadCount() },
  ]);

  /** Newest first, as the store gives them, narrowed by timeline, type, read state and search (case-insensitive). */
  protected readonly visible = computed<readonly Notification[]>(() => {
    const timeline = this.timelineId();
    const types = this.types();
    const unreadOnly = this.view() === 'unread';
    const q = this.search().trim().toLowerCase();
    return this.store.items().filter(
      (n) =>
        // An update about every timeline shows only under "All timelines".
        (timeline === 'all' || n.timelineId === timeline) &&
        (!types.length || types.includes(n.type)) &&
        (!unreadOnly || n.unread) &&
        (!q || `${n.subject} ${n.text} ${this.timelineNames[n.timelineId] ?? ''}`.toLowerCase().includes(q)),
    );
  });

  protected readonly applied = computed(() => {
    const chips: { key: FilterKey; label: string; values: string }[] = [];
    if (this.timelineId() !== 'all') chips.push({ key: 'timeline', label: 'Timeline', values: this.timelineNames[this.timelineId()] ?? this.timelineId() });
    if (this.types().length) chips.push({ key: 'type', label: 'Type', values: NOTIFICATION_TYPES.filter((t) => this.types().includes(t)).join(', ') });
    return chips;
  });

  /** Which empty state the list shows when `visible` is empty. */
  protected readonly emptyKind = computed<'unread' | 'no-match' | 'all'>(() => {
    if (this.store.items().length === 0) return 'all';
    if (this.view() === 'unread' && this.store.unreadCount() === 0) return 'unread';
    return 'no-match';
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const mock = params.get('mock');
      const simulated = MOCK_STATES.find((s) => s === mock);
      if (simulated) this.store.simulate(simulated);
      else if (this.simulating) void this.store.retry();
      this.simulating = !!simulated;
    });
    void this.store.load();
    inject(DestroyRef).onDestroy(() => {
      if (this.simulating) void this.store.retry();
    });

    if (typeof matchMedia === 'function') {
      const query = matchMedia(NARROW_QUERY);
      this.narrow.set(query.matches);
      const onChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected setView(value: string | null): void {
    this.view.set(value === 'unread' ? 'unread' : 'all');
  }

  protected clearFilter(key: FilterKey): void {
    if (key === 'timeline') this.timelineId.set('all');
    else this.types.set([]);
  }

  /** Clears the search and the filters; the All / Unread choice stays. */
  protected clearFilters(): void {
    this.timelineId.set('all');
    this.types.set([]);
    this.search.set('');
  }

  /** The action of the empty state: "Show all" (Unread is empty) or "Clear filters" (nothing matches). */
  protected onEmptyAction(): void {
    if (this.emptyKind() === 'unread') this.view.set('all');
    else this.clearFilters();
  }

  /** Reads the notification, then goes to its target; a same-URL reload so opening the same list twice still re-seeds Results. */
  protected open(n: Notification): void {
    this.store.markRead(n.id);
    void this.router.navigate([n.target.path], { queryParams: n.target.queryParams, onSameUrlNavigation: 'reload' });
  }
}
