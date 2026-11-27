import { Component, input } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../ui';

/** Placeholder rows of the SP results table: same card, header and row height as `SpResultsPage`. */
@Component({
  selector: 'qa-sp-results-rows-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading [label]="label()" class="block overflow-hidden rounded-xl border border-(--border) bg-(--surface)">
      <div class="flex h-10 items-center gap-6 border-b border-(--border) bg-(--surface-3) px-5">
        <qa-skeleton class="h-2.5 w-12" />
        <qa-skeleton class="h-2.5 w-24" />
        <qa-skeleton class="ml-auto h-2.5 w-20" />
      </div>
      @for (i of rows; track i) {
        <div class="flex min-h-[64px] items-center gap-6 border-b border-(--surface-4) px-5 last:border-b-0">
          <qa-skeleton class="h-3.5 w-14" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <qa-skeleton class="h-3.5 w-[60%]" />
            <qa-skeleton class="h-2.5 w-28" />
          </div>
          <qa-skeleton class="hidden h-3 w-10 sm:block" />
          <qa-skeleton class="hidden h-3 w-12 sm:block" />
          <qa-skeleton class="h-5 w-24 rounded-md" />
        </div>
      }
    </qa-loading>
  `,
})
export class SpResultsRowsSkeleton {
  readonly label = input('Loading the results');
  protected readonly rows = skeletonRows();
}

/** The SP results page while its timelines load: title, toolbar, then the rows. */
@Component({
  selector: 'qa-sp-results-skeleton',
  imports: [QaLoadingImports, SpResultsRowsSkeleton],
  host: { class: 'flex flex-col gap-5' },
  template: `
    <qa-loading label="Loading the timelines" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <qa-skeleton class="h-9 w-[280px] max-w-full rounded-lg" />
        <qa-skeleton class="h-5 w-64 max-w-full" />
      </div>
      <div class="flex flex-wrap gap-2">
        <qa-skeleton class="h-9 w-28 rounded-lg" />
        <qa-skeleton class="h-9 w-28 rounded-lg" />
      </div>
    </qa-loading>
    <qa-sp-results-rows-skeleton />
  `,
})
export class SpResultsSkeleton {}
