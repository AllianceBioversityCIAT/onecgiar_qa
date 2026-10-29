import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaMultiSelect, QaSelectImports, QaSelectOption, QaTabsImports } from '../../../ui';
import { PROGRAMS, PROGRAM_CODES, TIMELINES } from '../results/results.mock';
import { NotificationList, type NotificationsEmpty } from './notification-list';
import { NotificationsStore } from './notifications-store';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPES,
  sentenceText,
  type Notification,
  type NotificationCategory,
  type NotificationsLoadState,
} from './notifications.model';

type FilterKey = 'timeline' | 'type' | 'program';
type Tab = 'all' | NotificationCategory;

const TAB_LABELS: Readonly<Record<Tab, string>> = { all: 'All', action: 'Needs your action', info: 'For your information' };
const TABS: readonly Tab[] = ['all', 'action', 'info'];

/** The states the mock never reaches on its own, reachable with `?mock=` (design DD-9). Removed with the mock. */
const MOCK_STATES: readonly NotificationsLoadState[] = ['loading', 'error'];

const isMain = (kind: string): boolean => kind === 'Official timeline';

/**
 * Notifications: steps ready to move on and updates on the review of results, for the QA Admin (PRMS pattern adapted to QA).
 * Tabs split what needs the Admin's action from the updates; each tab counts what the other filters (timeline, type,
 * program, search) leave. The page only reads the store (the one source the bell reads too).
 * `?mock=loading|error` shows the loading or error state while the data is a mock. The store is shared and the router
 * reuses this view when only the query changes, so the switch follows every query change and ends when the page closes.
 */
@Component({
  selector: 'qa-notifications-view',
  templateUrl: './notifications-view.html',
  imports: [NgTemplateOutlet, QaButtonImports, HlmInput, QaSelectImports, QaMultiSelect, QaTabsImports, NotificationList],
})
export class NotificationsView {
  protected readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** True while this page shows a `?mock=` state. */
  private simulating = false;

  // ---------- Filters ----------
  /** "All timelines", then the main batch and the complementary batches (same order and groups as Results). */
  protected readonly timelineOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines' },
    ...[...TIMELINES]
      .sort((a, b) => Number(!isMain(a.kind)) - Number(!isMain(b.kind)))
      .map((t) => ({
        value: t.id,
        label: t.name,
        group: isMain(t.kind) ? 'Main batch' : 'Complementary batches',
        tag: isMain(t.kind) ? 'Main' : undefined,
      })),
  ];
  /** Timeline names by id, for the rows (the list and its rows read no mock). `all` is "All timelines". */
  protected readonly timelineNames: Readonly<Record<string, string>> = Object.fromEntries([
    ['all', 'All timelines'],
    ...TIMELINES.map((t) => [t.id, t.name]),
  ]);
  /** The batch pill of each row, by timeline id. */
  protected readonly batchLabels: Readonly<Record<string, string>> = Object.fromEntries([
    ['all', 'All batches'],
    ...TIMELINES.map((t) => [t.id, isMain(t.kind) ? 'Main batch' : 'Complementary batch']),
  ]);
  protected readonly programOptions = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));

  protected readonly tab = signal<Tab>('all');
  protected readonly timelineId = signal('all');
  protected readonly types = signal<readonly string[]>([]);
  protected readonly programs = signal<readonly string[]>([]);
  protected readonly search = signal('');

  /** The Type menu lists only the types of the current tab. */
  protected readonly typeOptions = computed(() =>
    NOTIFICATION_TYPES.filter((t) => this.tab() === 'all' || NOTIFICATION_CATEGORY[t] === this.tab()).map((t) => ({ value: t, label: t })),
  );

  /** Newest first, as the store gives them, narrowed by timeline, type, program and search (case-insensitive); not by tab. */
  private readonly filtered = computed<readonly Notification[]>(() => {
    const timeline = this.timelineId();
    const types = this.types();
    const programs = this.programs();
    const q = this.search().trim().toLowerCase();
    return this.store.items().filter(
      (n) =>
        // An update about every timeline shows only under "All timelines".
        (timeline === 'all' || n.timelineId === timeline) &&
        (!types.length || types.includes(n.type)) &&
        // An update about every program shows only when no program is chosen.
        (!programs.length || (n.program !== null && programs.includes(n.program))) &&
        (!q || `${sentenceText(n)} ${this.timelineNames[n.timelineId] ?? ''} ${n.step ?? ''}`.toLowerCase().includes(q)),
    );
  });

  /** The tabs, each with how many notifications it has under the current filters. */
  protected readonly tabs = computed(() =>
    TABS.map((value) => ({
      value,
      label: TAB_LABELS[value],
      count: value === 'all' ? this.filtered().length : this.filtered().filter((n) => NOTIFICATION_CATEGORY[n.type] === value).length,
    })),
  );

  protected readonly visible = computed<readonly Notification[]>(() => {
    const tab = this.tab();
    return tab === 'all' ? this.filtered() : this.filtered().filter((n) => NOTIFICATION_CATEGORY[n.type] === tab);
  });

  protected readonly applied = computed(() => {
    const chips: { key: FilterKey; label: string; values: string }[] = [];
    if (this.timelineId() !== 'all') chips.push({ key: 'timeline', label: 'Timeline', values: this.timelineNames[this.timelineId()] ?? this.timelineId() });
    if (this.types().length) chips.push({ key: 'type', label: 'Type', values: NOTIFICATION_TYPES.filter((t) => this.types().includes(t)).join(', ') });
    if (this.programs().length) chips.push({ key: 'program', label: 'Science program', values: PROGRAM_CODES.filter((c) => this.programs().includes(c)).join(', ') });
    return chips;
  });

  /** What the list says when it shows nothing: no data, filters that match nothing, or an empty tab. */
  protected readonly empty = computed<NotificationsEmpty>(() => {
    if (this.store.items().length === 0) return { title: 'No notifications yet', action: null };
    if (this.applied().length || this.search().trim()) return { title: 'No notifications match these filters', action: 'Clear filters' };
    return this.tab() === 'action' ? { title: 'Nothing needs your action', action: null } : { title: 'No updates yet', action: null };
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
  }

  /** Changes tab and drops the chosen types the new tab does not list, so the Type menu never hides a choice. */
  protected setTab(value: string | undefined): void {
    const tab = TABS.find((t) => t === value) ?? 'all';
    this.tab.set(tab);
    if (tab !== 'all') this.types.update((list) => list.filter((t) => NOTIFICATION_CATEGORY[t as keyof typeof NOTIFICATION_CATEGORY] === tab));
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearFilter(key: FilterKey): void {
    if (key === 'timeline') this.timelineId.set('all');
    else if (key === 'type') this.types.set([]);
    else this.programs.set([]);
  }

  /** Clears the search and the filters; the tab stays. */
  protected clearFilters(): void {
    this.timelineId.set('all');
    this.types.set([]);
    this.programs.set([]);
    this.search.set('');
  }

  /** Reads the notification, then goes to its target; a same-URL reload so opening the same list twice still re-seeds Results. */
  protected open(n: Notification): void {
    this.store.markRead(n.id);
    void this.router.navigate([n.target.path], { queryParams: n.target.queryParams, onSameUrlNavigation: 'reload' });
  }

  /** "Not now": only reads it. */
  protected dismiss(n: Notification): void {
    this.store.markRead(n.id);
  }
}
