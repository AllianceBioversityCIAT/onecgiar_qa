import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan/button';
import { HlmInput } from '@spartan/input';
import { QaMultiSelect, QaSelectImports, QaSelectOption } from '../../../ui';
import { ResultsDownloadDrawer } from './results-download-drawer';
import { ResultRowVm, ResultsTable, SortDir, SortKey } from './results-table';
import {
  ASSESSOR_NAMES,
  BATCHES,
  PROGRAMS,
  PROGRAM_CODES,
  PUBLISHED_PROGRAMS,
  QA_ROUNDS,
  QaResult,
  QaTimeline,
  RESULTS,
  RESULT_TYPES,
  ResultType,
  STATUS_CLASSES,
  STATUS_ORDER,
  TIMELINES,
} from './results.mock';

const PAGE_SIZE = 50;

/** A timeline with its non-automatic results (rows of the Timeline picker). */
interface TimelineOption extends QaTimeline {
  readonly count: number;
}

type FilterKey = 'program' | 'status' | 'round' | 'assessor' | 'batch';

const FILTER_LABELS: Readonly<Record<FilterKey, string>> = {
  program: 'Science program',
  status: 'Status',
  round: 'QA round',
  assessor: 'Assessor',
  batch: 'Timeline',
};

/** Comma-separated list from a query param (?status=Pending,In%20review). */
function listParam(value: string | null, allowed: readonly string[]): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));
}

/** "Results in QA": every result under assessment, with search, filters, type chips and sorting. */
@Component({
  selector: 'qa-results-view',
  templateUrl: './results-view.html',
  imports: [
    HlmButtonImports,
    HlmInput,
    DecimalPipe,
    RouterLink,
    QaMultiSelect,
    QaSelectImports,
    ResultsTable,
    ResultsDownloadDrawer,
  ],
})
export class ResultsView {
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;

  // Options of the filter menus (mockup FILTERS).
  protected readonly programOptions = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));
  protected readonly statusOptions = STATUS_ORDER.map((s) => ({ value: s, label: s }));
  protected readonly roundOptions: readonly QaSelectOption[] = [
    { value: '', label: 'All rounds' },
    ...QA_ROUNDS.map((r) => ({ value: r, label: r })),
  ];
  protected readonly assessorOptions = ASSESSOR_NAMES.map((a) => ({ value: a, label: a }));
  protected readonly batchOptions = BATCHES.map((b) => ({ value: b, label: b }));

  // Page state. Deep links (e.g. from Overview) can preset filters: ?status=…&program=…&assessor=…&type=…
  protected readonly timelineId = signal('all');
  protected readonly search = signal(this.params.get('q') ?? '');
  protected readonly programs = signal(listParam(this.params.get('program'), PROGRAM_CODES));
  protected readonly statuses = signal(listParam(this.params.get('status'), STATUS_ORDER));
  protected readonly round = signal('');
  protected readonly assessors = signal(listParam(this.params.get('assessor'), ASSESSOR_NAMES));
  protected readonly batches = signal<readonly string[]>([]);
  protected readonly typeChip = signal<ResultType | 'All'>(
    (RESULT_TYPES as readonly string[]).includes(this.params.get('type') ?? '')
      ? (this.params.get('type') as ResultType)
      : 'All',
  );
  protected readonly showAuto = signal(false);
  protected readonly sortKey = signal<SortKey | null>(null);
  protected readonly sortDir = signal<SortDir>('asc');
  protected readonly downloadOpen = signal(false);

  protected readonly resultTypes = RESULT_TYPES;

  private readonly timeline = computed(() => TIMELINES.find((t) => t.id === this.timelineId()) ?? null);

  /** Results of the selected timeline (all timelines when none is picked). */
  private readonly inTimeline = computed(() => {
    const t = this.timeline();
    return t ? RESULTS.filter((r) => r.batch === t.name) : RESULTS;
  });

  /** Non-automatic results per timeline: the counts of the timeline picker. */
  protected readonly timelineOptions = computed<readonly TimelineOption[]>(() =>
    TIMELINES.map((t) => ({ ...t, count: RESULTS.filter((r) => r.batch === t.name && r.status !== 'Automatic').length })),
  );
  protected readonly allCount = RESULTS.filter((r) => r.status !== 'Automatic').length;
  /** Timeline picker: "All timelines", then the official timeline and the sub-timelines. */
  protected readonly timelinePickerOptions = computed<readonly QaSelectOption[]>(() => [
    { value: 'all', label: 'All timelines' },
    ...[...this.timelineOptions()]
      .sort((a, b) => Number(a.kind !== 'Official timeline') - Number(b.kind !== 'Official timeline'))
      .map((t) => ({
        value: t.id,
        label: t.name,
        group: t.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timelines',
        tag: t.kind === 'Official timeline' ? 'Official' : 'Sub',
      })),
  ]);
  protected readonly timelineById = computed(() => new Map(this.timelineOptions().map((t) => [t.id, t])));
  protected readonly timelineTotal = computed(() => this.inTimeline().filter((r) => r.status !== 'Automatic').length);
  protected readonly timelineSuffix = computed(() => (this.timeline() ? ' in ' + this.timeline()!.name : ''));

  /** Search + program / assessor / timeline / round filters (everything except type and status). */
  private readonly baseMatch = computed(() => {
    const q = this.search().trim().toLowerCase();
    const programs = this.programs(), assessors = this.assessors(), batches = this.batches(), round = this.round();
    return (r: QaResult) =>
      (!q || r.code.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)) &&
      (!programs.length || programs.includes(r.program)) &&
      (!assessors.length || (r.assessor !== null && assessors.includes(r.assessor))) &&
      (!batches.length || batches.includes(r.batch)) &&
      (!round || r.round === round);
  });

  /** Filtering rules of the mockup: automatic results only show with the Automatic chip or status. */
  private readonly filtered = computed(() => {
    const match = this.baseMatch(), statuses = this.statuses(), type = this.typeChip(), autoOn = this.showAuto();
    return this.inTimeline().filter((r) => {
      const auto = r.status === 'Automatic';
      if (auto && !(autoOn || statuses.includes('Automatic'))) return false;
      if (!(auto && autoOn) && type !== 'All' && r.type !== type) return false;
      if (statuses.length && !statuses.includes(r.status) && !(auto && autoOn)) return false;
      return match(r);
    });
  });

  private readonly sorted = computed(() => {
    const key = this.sortKey();
    const rows = this.filtered();
    if (!key) return rows;
    const val = (r: QaResult): string | number =>
      key === 'comments' ? (r.comments ? r.comments[0] / r.comments[1] + r.comments[1] / 1000 : -1)
        : key === 'status' ? STATUS_ORDER.indexOf(r.status)
          : r[key];
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  });

  /** How many rows are rendered; back to one page whenever the list changes. */
  protected readonly pageSize = linkedSignal({ source: this.sorted, computation: () => PAGE_SIZE });
  protected readonly matchCount = computed(() => this.sorted().length);
  protected readonly remaining = computed(() => Math.max(0, this.matchCount() - this.pageSize()));

  protected readonly visibleRows = computed<readonly ResultRowVm[]>(() =>
    this.sorted().slice(0, this.pageSize()).map((r) => ({
      code: r.code,
      title: r.title,
      meta: r.assessor && r.status !== 'Pending' ? `${r.program} · ${r.assessor}` : r.program,
      type: r.type,
      comments: r.comments,
      locked: !!r.comments && r.status === 'In review' && !PUBLISHED_PROGRAMS.includes(r.program),
      r1: r.r1,
      r1Class: r.r1 && r.r1 !== 'new' ? STATUS_CLASSES[r.r1] : '',
      status: r.status,
      statusClass: STATUS_CLASSES[r.status],
      isAuto: r.status === 'Automatic',
    })),
  );

  /** Type chip counts follow the timeline, search and filters (but not the chip itself). */
  protected readonly typeCounts = computed(() => {
    const match = this.baseMatch(), statuses = this.statuses();
    const counts = new Map<ResultType | 'All', number>([['All', 0]]);
    for (const r of this.inTimeline()) {
      if (r.status === 'Automatic' || (statuses.length && !statuses.includes(r.status)) || !match(r)) continue;
      counts.set('All', (counts.get('All') ?? 0) + 1);
      counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    }
    return counts;
  });
  /** Phone picker that replaces the type chips: same options and counts as the chips. */
  protected readonly typeOptions = computed<readonly QaSelectOption[]>(() => {
    const counts = this.typeCounts();
    const label = (name: string, key: ResultType | 'All') => `${name} (${(counts.get(key) ?? 0).toLocaleString('en-US')})`;
    return [
      { value: 'All', label: label('All result types', 'All') },
      ...RESULT_TYPES.map((t) => ({ value: t, label: label(t, t) })),
    ];
  });
  protected readonly autoCount = computed(() => {
    const match = this.baseMatch();
    return this.inTimeline().filter((r) => r.status === 'Automatic' && match(r)).length;
  });

  protected readonly applied = computed(() => {
    const values: Record<FilterKey, readonly string[]> = {
      program: this.programs(),
      status: this.statuses(),
      round: this.round() ? [this.round()] : [],
      assessor: this.assessors(),
      batch: this.batches(),
    };
    return (Object.keys(FILTER_LABELS) as FilterKey[])
      .filter((k) => values[k].length > 0)
      .map((k) => ({ key: k, label: FILTER_LABELS[k], values: values[k].join(', ') }));
  });

  /** The selected timeline has no results at all (e.g. a scheduled sub-timeline). */
  protected readonly timelineEmpty = computed(() => this.inTimeline().length === 0);

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected selectType(value: string | null): void {
    this.typeChip.set((RESULT_TYPES as readonly string[]).includes(value ?? '') ? (value as ResultType) : 'All');
  }

  protected toggleAuto(): void {
    this.showAuto.update((v) => !v);
  }

  protected sortBy(key: SortKey): void {
    const active = this.sortKey() === key;
    this.sortDir.set(active && this.sortDir() === 'asc' ? 'desc' : 'asc');
    this.sortKey.set(key);
  }

  /** Card-mode "Sort by" picker: explicit field + direction, or back to the default order. */
  protected setSort(sort: { key: SortKey; dir: SortDir } | null): void {
    this.sortKey.set(sort?.key ?? null);
    this.sortDir.set(sort?.dir ?? 'asc');
  }

  protected showMore(): void {
    this.pageSize.update((n) => n + PAGE_SIZE);
  }

  protected clearFilter(key: FilterKey): void {
    if (key === 'program') this.programs.set([]);
    else if (key === 'status') this.statuses.set([]);
    else if (key === 'round') this.round.set('');
    else if (key === 'assessor') this.assessors.set([]);
    else this.batches.set([]);
  }

  protected clearAll(): void {
    this.programs.set([]);
    this.statuses.set([]);
    this.round.set('');
    this.assessors.set([]);
    this.batches.set([]);
    this.search.set('');
    this.typeChip.set('All');
  }

  protected exportComments(code: string): void {
    // TODO(api): export the comments of this result (.xlsx).
    void code;
  }

  protected reassign(code: string): void {
    // TODO(api): open the reassign-assessor flow for this result (not designed in the mockup yet).
    void code;
  }
}
