// @akili-spec assessment/step-1-assessment
import { Component } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../../ui';

/** Review page while the assessment loads: the navigator column, the title row and field cards (same frame). */
@Component({
  selector: 'qa-review-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading the assessment" class="block">
      <div class="flex min-h-[calc(100dvh-56px)] bg-(--surface-3) max-md:flex-col">
        <div class="box-border flex w-[240px] flex-none flex-col gap-3 border-r border-(--border) bg-(--surface) px-5 py-6 max-md:w-auto max-md:border-r-0 max-md:border-b max-md:px-4 max-md:py-4">
          <qa-skeleton class="h-2.5 w-20" />
          <qa-skeleton class="h-6 w-28" />
          <qa-skeleton class="h-3 w-36" />
          <qa-skeleton class="h-5 w-24 rounded-md" />
          <div class="mt-4 flex flex-col gap-2 max-md:hidden">
            @for (i of sections; track i) {
              <qa-skeleton class="h-9 w-full rounded-lg" />
            }
          </div>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-4 px-10 py-8 max-sm:px-4 max-sm:py-5">
          <qa-skeleton class="h-6 w-[60%]" />
          <qa-skeleton class="h-3 w-48" />
          <div class="flex flex-col gap-2.5 rounded-xl border border-(--border) bg-(--surface) p-6 max-sm:p-4">
            <qa-skeleton class="mb-2 h-4 w-40" />
            @for (i of cards; track i) {
              <div class="flex flex-col gap-2.5 rounded-lg border border-(--border) px-4 py-[14px]">
                <qa-skeleton class="h-3 w-44" />
                <qa-skeleton class="h-10 w-full rounded-lg" />
                <div class="flex gap-2"><qa-skeleton class="h-8 w-24 rounded-lg" /><qa-skeleton class="h-8 w-28 rounded-lg" /></div>
              </div>
            }
          </div>
        </div>
      </div>
    </qa-loading>
  `,
})
export class ReviewSkeleton {
  protected readonly sections = skeletonRows(6);
  protected readonly cards = skeletonRows(4);
}
