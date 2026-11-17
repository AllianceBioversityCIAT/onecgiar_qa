import { Component } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../ui';

/** The SP result view while it loads: header card, banner, section nav and field cards. */
@Component({
  selector: 'qa-sp-result-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading the result" class="flex flex-col gap-5">
      <div class="flex flex-col gap-3 rounded-xl border border-(--border) bg-(--surface) px-5 py-4">
        <div class="flex items-center gap-3">
          <qa-skeleton class="h-3.5 w-16" />
          <qa-skeleton class="h-5 w-28 rounded-full" />
        </div>
        <qa-skeleton class="h-6 w-[70%]" />
        <qa-skeleton class="h-3 w-80 max-w-full" />
      </div>
      <qa-skeleton class="h-10 w-full rounded-lg" />
      <div class="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div class="hidden flex-col gap-2 lg:flex">
          @for (i of nav; track i) {
            <qa-skeleton class="h-4 w-40" />
          }
        </div>
        <div class="flex flex-col gap-3">
          <qa-skeleton class="h-5 w-48" />
          @for (i of cards; track i) {
            <div class="flex flex-col gap-2 rounded-[10px] border border-(--border) bg-(--surface) px-4 py-3.5">
              <qa-skeleton class="h-3 w-32" />
              <qa-skeleton class="h-3.5 w-[80%]" />
            </div>
          }
        </div>
      </div>
    </qa-loading>
  `,
})
export class SpResultSkeleton {
  protected readonly nav = skeletonRows(5);
  protected readonly cards = skeletonRows(6);
}
