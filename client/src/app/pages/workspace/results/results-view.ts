import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, PRIMARY_OUTLET, ParamMap, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { HlmInput } from '@spartan/input';
import { QA_STATUSES, QaStatus } from '../../../core/api/assessment.models';
import { TableSort } from '../../../core/list/table-sort';
import { QaButtonImports, QaMultiSelect, QaScopeCardImports, QaSelectImports } from '../../../ui';
import { ResultsSkeleton } from './results-skeleton';
import { ResultsFilters, ResultsStore } from './results-store';
import { ResultsTable, SortDir, SortKey } from './results-table';
import { STATUS_LABELS, readOnlyText, timelineOptions, toRowVm } from './results.mapper';

/** Milliseconds the search box waits after the last key before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;

type FilterKey = 'status' | 'program' | 'type';

const FILTER_LABELS: Readonly<Record<FilterKey, string>> = {
  status: 'Status',
  program: 'Science program',
  type: 'Result type',
};

/** Values the API takes per list filter (contract § 3.2). */
const MAX_LIST_VALUES = 50;

/** Comma-separated list from a query param (?status=pending,quality_assessed): each value once, at most 50. */
function listParam(value: string | null): readonly string[] {
  const values = (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, MAX_LIST_VALUES);
}

const isStatus = (v: string): v is QaStatus => (QA_STATUSES as readonly string[]).includes(v);
const positiveInt = (v: string): number | null => (/^[1-9]\d{0,9}$/.test(v) ? Number(v) : null);

/**
 * The filters a /results URL carries: `timeline` (id), `status` (the 8 keys), `program` (CLARISA ids),
 * `type` (result type keys), `q`. Values that cannot be valid are dropped. The old `?stage=` of the
 * Overview and Notifications links is not a status of the new vocabulary, so it is dropped and the list
 * opens unfiltered (DD-13).
 */
export function readFilters(params: ParamMap): ResultsFilters {
  return {
    timelineId: positiveInt(params.get('timeline') ?? ''),
    statuses: listParam(params.get('status')).filter(isStatus),
    programIds: listParam(params.get('program'))
      .map(positiveInt)
      .filter((n): n is number => n !== null),
    typeKeys: listParam(params.get('type')).filter((k) => k.length <= 255),
    q: (params.get('q') ?? '').slice(0, 200),
  };
}

/**
 * "Results in QA" on the worklist API (T-18): the caller's results of one timeline, filtered, searched
 * and sorted on the server, with "Load more" (the API pages by cursor and gives no filtered total).
 * Auto-validated results are hidden unless the Status menu asks for them.
 */
@Component({
  selector: 'qa-results-view',
  templateUrl: './results-view.html',
  imports: [NgTemplateOutlet, QaButtonImports, HlmInput, RouterLink, QaMultiSelect, QaScopeCardImports, QaSelectImports, ResultsTable, ResultsSkeleton],
  providers: [ResultsStore],
})
export class ResultsView {
  private readonly router = inject(Router);
  protected readonly store = inject(ResultsStore);

  // Deep links (the Overview, a notification): ?timeline=29&status=pending&program=…&type=…&q=…
  // The filters are read from the URL on load and again on every navigation to /results (a notification
  // opened while this view is on screen reuses it); changing a filter by hand never writes the URL.

  protected readonly statuses = signal<readonly string[]>([]);
  protected readonly programs = signal<readonly string[]>([]);
  protected readonly types = signal<readonly string[]>([]);
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly sort = new TableSort<SortKey>();
  protected readonly sortKey = this.sort.key;
  protected readonly sortDir = this.sort.dir;

  /**
   * The filters the view was created with. The navigation that created it ends right after, with the
   * same URL: that first event is skipped once, so the page does not load twice.
   */
  private created: string | null;

  constructor() {
    const initial = readFilters(inject(ActivatedRoute).snapshot.queryParamMap);
    this.created = JSON.stringify(initial);
    this.apply(initial);
    // Re-seed from the event's own URL: the router reuses this view for a new ?query, and a same-URL
    // reload leaves `snapshot` untouched, so neither would reach the menus otherwise.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const url = this.router.parseUrl(event.urlAfterRedirects);
        const segments = url.root.children[PRIMARY_OUTLET]?.segments ?? [];
        if (segments.length !== 1 || segments[0].path !== 'results') return;
        const next = readFilters(url.queryParamMap);
        const first = this.created;
        this.created = null;
        if (first === JSON.stringify(next)) return;
        this.apply(next);
      });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  // ---------- Timeline ----------
  protected readonly timelineOptions = computed(() => timelineOptions(this.store.timelines()));
  protected readonly timelineValue = computed(() => {
    const id = this.store.timelineId();
    return id === null ? null : String(id);
  });

  /** Under the timeline in the context card: "Main batch · <step note>" (display only). */
  protected readonly timelineMeta = computed(() => {
    const option = this.timelineOptions().find((o) => o.value === this.timelineValue());
    if (!option) return null;
    const kind = option.group === 'Main batch' ? 'Main batch' : 'Complementary batch';
    return [kind, option.description].filter(Boolean).join(' · ');
  });

  /** Big number at the right of the context card, once the timeline answered. */
  protected readonly totalText = computed(() => (this.store.state() === 'ready' ? this.store.counters().total.toLocaleString('en-US') : null));

  protected onTimeline(value: string | null): void {
    const id = value ? Number(value) : null;
    if (!id || id === this.store.timelineId()) return;
    // A search still waiting for its pause travels with the switch (its timer would refresh the old timeline).
    clearTimeout(this.searchTimer);
    void this.store.selectTimeline(id, this.current()).then(() => this.dropUnoffered());
  }

  /** After a timeline switch: a program or a result type the new timeline does not offer leaves the menus and the query. */
  private dropUnoffered(): void {
    if (this.store.state() !== 'ready') return;
    const programs = this.programs().filter((v) => this.programOptions().some((o) => o.value === v));
    const types = this.types().filter((v) => this.typeOptions().some((o) => o.value === v));
    if (programs.length === this.programs().length && types.length === this.types().length) return;
    this.programs.set(programs);
    this.types.set(types);
    this.refetch();
  }

  // ---------- Menus (options from the server, limited to the caller's scope) ----------
  protected readonly statusOptions = computed(() => {
    const fromServer = this.store.options().statuses;
    const list = fromServer.length ? fromServer : QA_STATUSES.map((key) => ({ key, label: STATUS_LABELS[key] }));
    return list.map((s) => ({ value: s.key, label: s.label }));
  });
  protected readonly programOptions = computed(() =>
    this.store.options().programs.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })),
  );
  protected readonly typeOptions = computed(() =>
    this.store.options().resultTypes.map((t) => ({ value: t.key, label: t.label })),
  );

  protected setStatuses(value: readonly string[]): void {
    this.statuses.set(value);
    this.refetch();
  }

  protected setPrograms(value: readonly string[]): void {
    this.programs.set(value);
    this.refetch();
  }

  protected setTypes(value: readonly string[]): void {
    this.types.set(value);
    this.refetch();
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refetch(), SEARCH_DEBOUNCE_MS);
  }

  // ---------- Table ----------
  protected readonly rows = computed(() => this.store.rows().map(toRowVm));
  protected readonly readOnly = computed(() => readOnlyText(this.store.readOnlyReason()));
  protected readonly isAdmin = computed(() => this.store.timelines().some((t) => t.roles.includes('ADMIN')));
  protected readonly hasFilters = computed(
    () => !!(this.statuses().length || this.programs().length || this.types().length || this.search().trim()),
  );

  protected sortBy(key: SortKey): void {
    this.sort.toggle(key);
    this.pushSort();
  }

  /** Card-mode "Sort by" picker: explicit field + direction, or back to the default order. */
  protected setSort(sort: { key: SortKey; dir: SortDir } | null): void {
    this.sort.set(sort);
    this.pushSort();
  }

  private pushSort(): void {
    const key = this.sort.key();
    void this.store.setSort(key ? { key, dir: this.sort.dir() } : null);
  }

  // ---------- Applied filters ----------
  protected readonly applied = computed(() => {
    const labelOf = (options: readonly { value: string; label: string }[], values: readonly string[]) =>
      values.map((v) => options.find((o) => o.value === v)?.label ?? v);
    const values: Record<FilterKey, readonly string[]> = {
      status: labelOf(this.statusOptions(), this.statuses()),
      program: labelOf(this.programOptions(), this.programs()),
      type: labelOf(this.typeOptions(), this.types()),
    };
    return (Object.keys(FILTER_LABELS) as FilterKey[])
      .filter((k) => values[k].length > 0)
      .map((k) => ({ key: k, label: FILTER_LABELS[k], values: values[k].join(', ') }));
  });

  protected clearFilter(key: FilterKey): void {
    if (key === 'status') this.statuses.set([]);
    else if (key === 'program') this.programs.set([]);
    else this.types.set([]);
    this.refetch();
  }

  /** Clears search and menus; the timeline stays. */
  protected clearAll(): void {
    clearTimeout(this.searchTimer);
    this.statuses.set([]);
    this.programs.set([]);
    this.types.set([]);
    this.search.set('');
    this.refetch();
  }

  /** The URL decides everything again: menus, search and timeline, then a fresh load. */
  private apply(f: ResultsFilters): void {
    clearTimeout(this.searchTimer);
    this.statuses.set(f.statuses);
    this.programs.set(f.programIds.map(String));
    this.types.set(f.typeKeys);
    this.search.set(f.q);
    void this.store.load(f);
  }

  private refetch(): void {
    clearTimeout(this.searchTimer);
    void this.store.setFilters(this.current());
  }

  /** What the menus and the search box say now. */
  private current(): Omit<ResultsFilters, 'timelineId'> {
    return {
      statuses: this.statuses().filter(isStatus),
      programIds: this.programs().map(Number).filter((n) => Number.isInteger(n) && n > 0),
      typeKeys: this.types(),
      q: this.search(),
    };
  }
}

