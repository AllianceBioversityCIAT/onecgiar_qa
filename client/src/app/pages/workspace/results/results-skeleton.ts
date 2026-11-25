import { Component } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../../ui';

/** Title widths of the placeholder rows, so the column does not read as a solid block. */
const TITLES = ['w-[70%]', 'w-[55%]', 'w-[80%]', 'w-[62%]', 'w-[48%]', 'w-[75%]', 'w-[58%]', 'w-[66%]', 'w-[52%]', 'w-[72%]'];

/**
 * Results page while it loads: the timeline line, the filter bar and the table card with the same
 * responsive grid as `results-table.ts` (cards < 640px, 5 columns, 6 from 896px), 10 rows.
 */
@Component({
  selector: 'qa-results-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading results" class="flex flex-col gap-5">
      <div class="flex flex-col gap-3">
        <qa-skeleton class="h-5 w-56" />
        <div class="flex flex-wrap items-center gap-2 lg:gap-3">
          <qa-skeleton class="h-9 w-[320px] max-w-full rounded-lg max-sm:h-10 max-sm:w-full" />
          <qa-skeleton class="h-9 w-24 rounded-lg" />
          <qa-skeleton class="h-9 w-36 rounded-lg" />
          <qa-skeleton class="h-9 w-28 rounded-lg" />
        </div>
      </div>
      <qa-skeleton class="h-3 w-64" />
      <div class="@container overflow-hidden rounded-xl border border-(--border) bg-(--surface)">
        <div class="hidden h-10 items-center gap-x-3 border-b border-(--border) bg-(--surface-3) px-5 @min-[640px]:grid" [class]="grid">
          <qa-skeleton class="h-2.5 w-10" />
          <qa-skeleton class="h-2.5 w-12" />
          <qa-skeleton class="hidden h-2.5 w-20 @min-[896px]:block" />
          <qa-skeleton class="h-2.5 w-16 justify-self-end" />
          <qa-skeleton class="h-2.5 w-12 justify-self-end" />
        </div>
        @for (i of rows; track i) {
          <div
            class="grid items-center gap-x-3 gap-y-1.5 px-4 py-3 @min-[640px]:min-h-[72px] @min-[640px]:px-5 @min-[640px]:py-2"
            [class]="grid + (i < rows.length - 1 ? ' border-b border-(--surface-4)' : '')"
          >
            <qa-skeleton class="h-3.5 w-16" />
            <div class="col-span-3 row-start-2 flex min-w-0 flex-col gap-1.5 @min-[640px]:col-span-1 @min-[640px]:col-start-2 @min-[640px]:row-start-1">
              <qa-skeleton class="h-3.5" [class]="titles[i]" />
              <qa-skeleton class="h-2.5 w-24" />
            </div>
            <qa-skeleton class="hidden h-3 w-28 @min-[896px]:block" />
            <qa-skeleton class="hidden h-3 w-5 justify-self-end @min-[640px]:block" />
            <qa-skeleton class="col-start-2 row-start-1 h-5 w-20 justify-self-end rounded-full @min-[640px]:col-start-auto @min-[640px]:row-start-auto" />
          </div>
        }
      </div>
    </qa-loading>
  `,
})
export class ResultsSkeleton {
  protected readonly rows = skeletonRows();
  protected readonly titles = TITLES;
  /** Same columns as the real table (`GRID` in `results-table.ts`). */
  protected readonly grid =
    'grid-cols-[minmax(0,1fr)_auto_40px] ' +
    '@min-[640px]:grid-cols-[96px_minmax(0,1fr)_72px_150px_32px] ' +
    '@min-[896px]:grid-cols-[96px_minmax(0,1fr)_180px_84px_150px_32px] ' +
    '@min-[1000px]:grid-cols-[96px_minmax(180px,1fr)_220px_84px_160px_32px]';
}
