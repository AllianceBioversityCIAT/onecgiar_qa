import { Component, DestroyRef, computed, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaMenuImports, QaSelectImports, QaSelectOption } from '../../../ui';
import { PreviousOutcome, ResultStatus } from './results.mock';

export type SortKey = 'code' | 'title' | 'type' | 'comments' | 'r1' | 'status';
export type SortDir = 'asc' | 'desc';

export interface ResultRowVm {
  readonly code: string;
  readonly title: string;
  /** Second line under the title: "SP02 · M. Chen". */
  readonly meta: string;
  readonly type: string;
  readonly comments: readonly [number, number] | null;
  /** Comments not published to the program yet. */
  readonly locked: boolean;
  readonly r1: PreviousOutcome;
  readonly r1Class: string;
  readonly status: ResultStatus;
  readonly statusClass: string;
  readonly isAuto: boolean;
}

interface Column {
  readonly key: SortKey;
  readonly label: string;
  readonly right: boolean;
  /** Secondary columns are merged into other cells below the wide layout. */
  readonly secondary: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: 'code', label: 'Code', right: false, secondary: false },
  { key: 'title', label: 'Title', right: false, secondary: false },
  { key: 'type', label: 'Result type', right: false, secondary: true },
  { key: 'comments', label: 'Comments', right: true, secondary: false },
  { key: 'r1', label: 'Previous outcome', right: false, secondary: true },
  { key: 'status', label: 'Status', right: true, secondary: false },
];

/** Options of the card-mode "Sort by" picker: value = "key:dir", same state as the header sort. */
const SORT_OPTIONS: readonly QaSelectOption[] = [
  { value: '', label: 'Default order' },
  { value: 'code:asc', label: 'Code (ascending)' },
  { value: 'code:desc', label: 'Code (descending)' },
  { value: 'title:asc', label: 'Title (A–Z)' },
  { value: 'title:desc', label: 'Title (Z–A)' },
  { value: 'type:asc', label: 'Result type (A–Z)' },
  { value: 'type:desc', label: 'Result type (Z–A)' },
  { value: 'comments:desc', label: 'Comments (most resolved first)' },
  { value: 'comments:asc', label: 'Comments (least resolved first)' },
  { value: 'r1:asc', label: 'Previous outcome (A–Z)' },
  { value: 'r1:desc', label: 'Previous outcome (Z–A)' },
  { value: 'status:asc', label: 'Status (workflow order)' },
  { value: 'status:desc', label: 'Status (reverse order)' },
];

/*
 * Layout by the table's own width (container queries on the host):
 * - < 640px   stacked card rows: code · status · ⋯ / title + meta / comments · previous outcome. No header row.
 * - 640–896   5 columns: Code | Title (meta · result type) | Comments | Status over Previous outcome | ⋯
 * - 896–1000  all 7 columns, compact widths.
 * - ≥ 1000px  all 7 columns with the mockup widths.
 */
const GRID =
  'grid-cols-[minmax(0,1fr)_auto_40px] gap-x-3 gap-y-1.5 ' +
  '@min-[640px]:grid-cols-[96px_minmax(0,1fr)_72px_172px_32px] @min-[640px]:gap-y-1 ' +
  '@min-[896px]:grid-cols-[96px_minmax(0,1fr)_160px_84px_140px_130px_32px] @min-[896px]:gap-y-0 ' +
  '@min-[1000px]:grid-cols-[96px_minmax(180px,1fr)_200px_84px_150px_140px_32px]';

const CELL = {
  code: 'col-start-1 row-start-1 @min-[640px]:row-span-2 @min-[896px]:row-span-1',
  title: 'col-span-3 row-start-2 @min-[640px]:col-span-1 @min-[640px]:col-start-2 @min-[640px]:row-start-1 @min-[640px]:row-span-2 @min-[896px]:row-span-1',
  type: 'hidden @min-[896px]:col-start-3 @min-[896px]:row-start-1 @min-[896px]:block',
  comments: 'col-start-1 row-start-3 justify-start @min-[640px]:col-start-3 @min-[640px]:row-start-1 @min-[640px]:row-span-2 @min-[640px]:justify-end @min-[896px]:col-start-4 @min-[896px]:row-span-1',
  r1: 'col-span-2 col-start-2 row-start-3 justify-end @min-[640px]:col-span-1 @min-[640px]:col-start-4 @min-[640px]:row-start-2 @min-[640px]:self-start @min-[896px]:col-start-5 @min-[896px]:row-start-1 @min-[896px]:self-center @min-[896px]:justify-start',
  status: 'col-start-2 row-start-1 justify-self-end @min-[640px]:col-start-4 @min-[640px]:row-start-1 @min-[896px]:col-start-6 @min-[896px]:self-center',
  menu: 'col-start-3 row-start-1 justify-self-end @min-[640px]:col-start-5 @min-[640px]:row-span-2 @min-[896px]:col-start-7 @min-[896px]:row-span-1',
} as const;

/** Results table: sticky sortable headers, rows that open the review page, and a ⋯ menu per row. */
@Component({
  selector: 'qa-results-table',
  imports: [RouterLink, QaMenuImports, QaSelectImports],
  // No own overflow: the sticky header row sticks to the scrolling <main> of the shell.
  host: { class: '@container relative block rounded-xl border border-(--border) bg-(--surface)' },
  template: `
    <span #stickSentinel aria-hidden="true" class="pointer-events-none absolute top-0 left-0 h-px w-px"></span>
    <!-- Card mode only (no header row): sorting through a picker that shares the header sort state. -->
    <div class="flex items-center gap-3 rounded-t-[11px] border-b border-(--border) bg-(--surface-3) px-4 py-2 @min-[640px]:hidden">
      <span class="flex-none text-(length:--fs-13) font-medium text-(--text-3)" aria-hidden="true">Sort by</span>
      <qa-select
        [value]="sortValue()"
        (valueChange)="onSortPick($event)"
        [options]="sortOptions"
        label="Sort by"
        appearance="field"
        class="min-w-0 flex-1"
      />
    </div>
    <table class="block w-full">
      <thead class="sticky top-0 z-20 hidden @min-[640px]:block">
        <tr
          class="grid h-10 items-center px-5 border-b border-(--border) bg-(--surface-3)"
          [class]="grid + (stuck() ? ' rounded-none shadow-[0_1px_0_var(--border)]' : ' rounded-t-[11px]')"
        >
          @for (col of columns; track col.key) {
            @let active = sortKey() === col.key;
            <th
              scope="col"
              class="min-w-0 p-0 font-normal"
              [class]="col.secondary ? 'hidden @min-[896px]:block' : ''"
              [attr.aria-sort]="active ? (sortDir() === 'asc' ? 'ascending' : 'descending') : null"
            >
              <button
                type="button"
                (click)="sort.emit(col.key)"
                class="flex h-10 w-full min-w-0 items-center gap-1 p-0 text-(length:--fs-11) font-semibold tracking-[0.06em] whitespace-nowrap uppercase hover:text-(--text-2) outline-none focus-visible:shadow-(--focus-ring)"
                [class]="(col.right ? 'justify-end' : 'justify-start') + (active ? ' text-(--text-2)' : ' text-(--text-muted)')"
              >
                <span>{{ col.label }}</span>
                @if (active && sortDir() === 'asc') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                }
                @if (active && sortDir() === 'desc') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                }
              </button>
            </th>
          }
          <th scope="col" class="p-0"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody class="block">
        @for (r of rows(); track r.code; let last = $last) {
          <tr
            class="relative grid items-center border-b border-(--surface-4) bg-(--surface) px-4 py-3 hover:bg-(--surface-2) @min-[640px]:min-h-[72px] @min-[640px]:px-5 @min-[640px]:py-2"
            [class]="grid + (last ? ' rounded-b-[11px]' : '')"
          >
            <td class="flex items-center self-stretch" [class]="cell.code">
              <a
                [routerLink]="['/results', r.code]"
                class="font-(family-name:--qa-mono) tabular-nums text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) outline-none after:absolute after:inset-0 focus-visible:after:inset-ring-2 focus-visible:after:inset-ring-(--primary)"
                [class]="last ? 'after:rounded-b-[11px]' : ''"
              >{{ r.code }}</a>
            </td>
            <td class="flex min-w-0 flex-col justify-center gap-0.5 self-stretch" [class]="cell.title">
              <span [title]="r.title" class="min-w-0 truncate text-(length:--fs-14) text-(--text) @max-[640px]:line-clamp-2 @max-[640px]:whitespace-normal">{{ r.title }}</span>
              <span [title]="r.meta + ' · ' + r.type" class="min-w-0 truncate text-(length:--fs-12) text-(--text-4) @max-[640px]:whitespace-normal">{{ r.meta }}<span class="@min-[896px]:hidden"> · {{ r.type }}</span></span>
            </td>
            <td class="min-w-0 truncate text-(length:--fs-13) text-(--text-3)" [class]="cell.type">{{ r.type }}</td>
            <td class="flex items-center gap-[5px] font-(family-name:--qa-mono) tabular-nums text-(length:--fs-13) whitespace-nowrap" [class]="cell.comments">
              @if (r.comments; as c) {
                <span><span class="font-semibold text-(--text)">{{ c[0] }}</span><span class="text-(--text-4)"> / {{ c[1] }}</span><span class="font-sans text-(length:--fs-12) text-(--text-4) @min-[640px]:sr-only"> comments</span></span>
              } @else {
                <span class="text-(--text-muted) @max-[640px]:hidden">–</span>
                <span class="font-sans text-(length:--fs-12) text-(--text-4) @min-[640px]:hidden">No comments</span>
              }
              @if (r.locked) {
                <span title="Not published to the program yet" class="inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="flex-none"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" /></svg><span class="sr-only">Not published to the program yet</span></span>
              }
            </td>
            <td class="flex min-w-0 items-center gap-1.5" [class]="cell.r1">
              @if (r.r1) {
                <span class="text-(length:--fs-11) whitespace-nowrap text-(--text-4) @min-[896px]:hidden">Previous</span>
              }
              @if (r.r1 === 'new') {
                <span class="rounded-full bg-(--tint-2) px-2 py-0.5 text-(length:--fs-11) font-semibold whitespace-nowrap text-(--accent)">First assessment</span>
              } @else if (r.r1) {
                <span class="inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="r.r1Class">{{ r.r1 }}</span>
              }
            </td>
            <td
              class="flex"
              [class]="cell.status + (r.r1 ? ' @min-[640px]:self-end @min-[896px]:self-center' : ' @min-[640px]:row-span-2 @min-[640px]:self-center @min-[896px]:row-span-1')"
            >
              <span class="inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="r.statusClass">
                @if (r.isAuto) {
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="flex-none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                }
                {{ r.status }}
              </span>
            </td>
            <td class="relative z-10" [class]="cell.menu">
              <button
                type="button"
                [qaMenuTrigger]="rowMenu"
                [qaMenuTriggerData]="{ $implicit: r }"
                qaMenuAlign="end"
                [attr.aria-label]="'More actions for ' + r.code"
                class="-mr-2 flex size-10 items-center justify-center rounded-md text-(--text-3) hover:text-(--primary) outline-none focus-visible:shadow-(--focus-ring) @min-[640px]:mr-0 @min-[640px]:size-6"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></svg>
              </button>
            </td>
          </tr>
        }
      </tbody>
    </table>

    <ng-template #rowMenu let-r>
      <qa-menu-panel width="220px" [attr.aria-label]="'Actions for ' + r.code">
        <button qaMenuItem (triggered)="exportComments.emit(r.code)">Export comments</button>
        @if (!r.isAuto) {
          <button qaMenuItem (triggered)="reassign.emit(r.code)">Reassign assessor</button>
        }
      </qa-menu-panel>
    </ng-template>
  `,
})
export class ResultsTable {
  readonly rows = input.required<readonly ResultRowVm[]>();
  readonly sortKey = input<SortKey | null>(null);
  readonly sortDir = input<SortDir>('asc');

  /** Header click: toggles the direction of that column. */
  readonly sort = output<SortKey>();
  /** Card-mode picker: sets field and direction at once (null = default order). */
  readonly sortSet = output<{ key: SortKey; dir: SortDir } | null>();
  readonly exportComments = output<string>();
  readonly reassign = output<string>();

  protected readonly columns = COLUMNS;
  protected readonly grid = GRID;
  protected readonly cell = CELL;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly sortValue = computed(() => {
    const key = this.sortKey();
    return key ? `${key}:${this.sortDir()}` : '';
  });

  protected onSortPick(value: string | null): void {
    const [key, dir] = (value ?? '').split(':') as [SortKey | '', SortDir | undefined];
    this.sortSet.emit(key && dir ? { key, dir } : null);
  }

  /** True while the header row is stuck to the top of the scrolling <main> (square its corners). */
  protected readonly stuck = signal(false);
  private readonly stickSentinel = viewChild.required<ElementRef<HTMLElement>>('stickSentinel');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const sentinel = this.stickSentinel().nativeElement;
      if (typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          const top = entry.rootBounds?.top ?? 0;
          this.stuck.set(!entry.isIntersecting && entry.boundingClientRect.top < top);
        },
        { root: sentinel.closest('main'), threshold: 0 },
      );
      observer.observe(sentinel);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
