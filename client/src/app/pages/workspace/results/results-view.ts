import { Component, ElementRef, computed, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaMultiSelect, QaPagination, QaSelectImports, QaSelectOption } from '../../../ui';
import { TableSort } from '../../../core/list/table-sort';
import { ResultRowVm, ResultsTable, SortDir, SortKey } from './results-table';
import {
  ASSESSOR_NAMES,
  PROGRAMS,
  PROGRAM_CODES,
  PUBLISHED_PROGRAMS,
  QA_STAGES,
  QaResult,
  QaStage,
  RESULTS,
  RESULT_STAGES,
  RESULT_STAGE_CLASSES,
  RESULT_STAGE_LABELS,
  RESULT_STAGE_SHORT,
  RESULT_TYPES,
  STATUS_ORDER,
  TIMELINES,
  qaStage,
} from './results.mock';

const PAGE_SIZE = 25;

/** Group heading of a stage in the "QA stage" menu (the Overview's Round 1 / Round 2 columns, then the final state). */
const stageGroup = (s: QaStage): string => (s.startsWith('r1-') ? 'Round 1' : s.startsWith('r2-') ? 'Round 2' : 'Final');

type FilterKey = 'stage' | 'program' | 'type' | 'assessor' | 'status';

const FILTER_LABELS: Readonly<Record<FilterKey, string>> = {
  stage: 'QA stage',
  program: 'Science program',
  type: 'Result type',
  assessor: 'Assessor',
  status: 'Status',
};

/** Comma-separated list from a query param (?program=SP02,SP05). */
function listParam(value: string | null, allowed: readonly string[]): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));
}

/**
 * "Results in QA": every result under assessment, filtered by search, timeline (a picker, since sub-timelines can grow
 * in number), QA stage (grouped by round), program, type and assessor, with sorting.
 * Automatic results (approved by the knowledge product auto-check) are not under assessment, so they are not listed.
 */
@Component({
  selector: 'qa-results-view',
  templateUrl: './results-view.html',
  imports: [QaButtonImports, HlmInput, RouterLink, QaMultiSelect, QaSelectImports, ResultsTable, QaPagination],
})
export class ResultsView {
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;

  // Deep links (e.g. from the Overview): ?timeline=jul&stage=r1-one&program=…&type=…&assessor=…
  // ?status=… is kept for the Overview's "waiting on a program" link; it has no menu and shows as an applied filter.

  // ---------- Timeline ----------
  /** "All timelines", then the official timeline and the sub-timelines, each with its results under assessment. */
  protected readonly timelineOptions: readonly QaSelectOption[] = [
    { value: 'all', label: 'All timelines', count: RESULTS.filter((r) => qaStage(r)).length.toLocaleString('en-US') },
    ...[...TIMELINES]
      .sort((a, b) => Number(a.kind !== 'Official timeline') - Number(b.kind !== 'Official timeline'))
      .map((t) => ({
        value: t.id,
        label: t.name,
        group: t.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timelines',
        tag: t.kind === 'Official timeline' ? 'Official' : 'Sub',
        count: RESULTS.filter((r) => r.batch === t.name && qaStage(r)).length.toLocaleString('en-US'),
      })),
  ];
  protected readonly timelineId = signal(TIMELINES.some((t) => t.id === this.params.get('timeline')) ? this.params.get('timeline')! : 'all');
  private readonly timeline = computed(() => TIMELINES.find((t) => t.id === this.timelineId()) ?? null);
  /** Results of the selected timeline that are under assessment (automatic ones left out). */
  private readonly inTimeline = computed(() => {
    const t = this.timeline();
    return RESULTS.filter((r) => qaStage(r) && (!t || r.batch === t.name));
  });
  protected readonly timelineEmpty = computed(() => this.inTimeline().length === 0);

  // ---------- Menus ----------
  protected readonly stages = signal(listParam(this.params.get('stage'), QA_STAGES));
  protected readonly programOptions = PROGRAM_CODES.map((c) => ({ value: c, label: `${c} ${PROGRAMS[c]}` }));
  protected readonly typeOptions = RESULT_TYPES.map((t) => ({ value: t, label: t }));
  protected readonly assessorOptions = ASSESSOR_NAMES.map((a) => ({ value: a, label: a }));
  protected readonly search = signal(this.params.get('q') ?? '');
  protected readonly programs = signal(listParam(this.params.get('program'), PROGRAM_CODES));
  protected readonly types = signal(listParam(this.params.get('type'), RESULT_TYPES));
  protected readonly assessors = signal(listParam(this.params.get('assessor'), ASSESSOR_NAMES));
  protected readonly statuses = signal(listParam(this.params.get('status'), STATUS_ORDER));

  protected readonly sort = new TableSort<SortKey>();
  protected readonly sortKey = this.sort.key;
  protected readonly sortDir = this.sort.dir;

  /** Results of the timeline that pass every menu except QA stage (the base of the stage counts). */
  private readonly narrowed = computed(() => {
    const q = this.search().trim().toLowerCase();
    const programs = this.programs(), types = this.types(), assessors = this.assessors(), statuses = this.statuses();
    return this.inTimeline().filter(
      (r) =>
        (!q || r.code.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)) &&
        (!programs.length || programs.includes(r.program)) &&
        (!types.length || types.includes(r.type)) &&
        (!assessors.length || (r.assessor !== null && assessors.includes(r.assessor))) &&
        (!statuses.length || statuses.includes(r.status)),
    );
  });

  /** "QA stage" menu: grouped by Round 1 / Round 2, then Quality assessed; counts follow the other filters. */
  protected readonly stageOptions = computed(() => {
    const counts = new Map<QaStage, number>();
    for (const r of this.narrowed()) {
      const s = qaStage(r)!;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return QA_STAGES.map((s) => ({
      value: s,
      label: RESULT_STAGE_SHORT[s],
      group: stageGroup(s),
      count: (counts.get(s) ?? 0).toLocaleString('en-US'),
    }));
  });

  private readonly filtered = computed(() => {
    const stages = this.stages();
    return stages.length ? this.narrowed().filter((r) => stages.includes(qaStage(r)!)) : this.narrowed();
  });

  private readonly sorted = computed(() =>
    this.sort.apply(this.filtered(), (r: QaResult, key): string | number =>
      key === 'comments' ? (r.comments ? r.comments[0] / r.comments[1] + r.comments[1] / 1000 : -1)
        : key === 'stage' ? RESULT_STAGES.indexOf(qaStage(r)!)
          : r[key],
    ),
  );

  /** Rows per page ("25 per page"); the page goes back to 1 whenever the list or the size changes. */
  protected readonly pageSize = signal(PAGE_SIZE);
  protected readonly page = linkedSignal({ source: () => [this.sorted(), this.pageSize()] as const, computation: () => 1 });
  protected readonly matchCount = computed(() => this.sorted().length);
  private readonly table = viewChild(ResultsTable, { read: ElementRef });

  protected readonly visibleRows = computed<readonly ResultRowVm[]>(() =>
    this.sorted().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((r) => {
      const stage = qaStage(r)!;
      const group = stageGroup(stage);
      return {
        code: r.code,
        title: r.title,
        meta: r.assessor && r.status !== 'Pending' ? `${r.program} · ${r.assessor}` : r.program,
        type: r.type,
        comments: r.comments,
        locked: !!r.comments && r.status === 'In review' && !PUBLISHED_PROGRAMS.includes(r.program),
        // The round sits above the stage pill; Quality assessed is past both rounds.
        round: group === 'Final' ? '' : group,
        stage,
        stageLabel: RESULT_STAGE_SHORT[stage],
        stageClass: RESULT_STAGE_CLASSES[stage],
        isAuto: false,
      };
    }),
  );

  protected readonly applied = computed(() => {
    const values: Record<FilterKey, readonly string[]> = {
      // Workflow order, with the round ("Round 1 · Pending"), whatever order they were ticked in.
      stage: QA_STAGES.filter((s) => this.stages().includes(s)).map((s) => RESULT_STAGE_LABELS[s]),
      program: this.programs(),
      type: this.types(),
      assessor: this.assessors(),
      status: this.statuses(),
    };
    return (Object.keys(FILTER_LABELS) as FilterKey[])
      .filter((k) => values[k].length > 0)
      .map((k) => ({ key: k, label: FILTER_LABELS[k], values: values[k].join(', ') }));
  });

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected sortBy(key: SortKey): void {
    this.sort.toggle(key);
  }

  /** Card-mode "Sort by" picker: explicit field + direction, or back to the default order. */
  protected setSort(sort: { key: SortKey; dir: SortDir } | null): void {
    this.sort.set(sort);
  }

  /** New page: bring the top of the table back into view if it was scrolled past. */
  protected onPage(): void {
    const el: HTMLElement | undefined = this.table()?.nativeElement;
    const top = el?.closest('main')?.getBoundingClientRect().top ?? 0;
    if (el && el.getBoundingClientRect().top < top) el.scrollIntoView({ block: 'start' });
  }

  protected clearFilter(key: FilterKey): void {
    if (key === 'stage') this.stages.set([]);
    else if (key === 'program') this.programs.set([]);
    else if (key === 'type') this.types.set([]);
    else if (key === 'assessor') this.assessors.set([]);
    else this.statuses.set([]);
  }

  /** Clears search and menus; the timeline stays. */
  protected clearAll(): void {
    this.stages.set([]);
    this.programs.set([]);
    this.types.set([]);
    this.assessors.set([]);
    this.statuses.set([]);
    this.search.set('');
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
