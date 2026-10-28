import { Component } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../../ui';

/** Steps of a placeholder timeline (the usual official calendar has five). */
const STEPS = skeletonRows(5);

/**
 * Cycle view while it loads: official timeline card (header, round band, rail, step cards)
 * and the sub-timelines header with its tabs, same frame and grid as the real ones.
 */
@Component({
  selector: 'qa-cycle-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading the cycle" class="flex flex-col gap-6">
      <section class="rounded-[12px] border border-(--border) bg-(--surface)">
        <div
          class="flex min-h-16 flex-wrap items-center gap-3 border-b border-(--surface-4) px-5 py-4"
        >
          <div class="flex min-w-0 flex-[1_1_14rem] flex-col gap-2">
            <qa-skeleton class="h-4 w-48" />
            <qa-skeleton class="h-3 w-72 max-w-full" />
          </div>
          <qa-skeleton class="h-9 w-[124px] rounded-[8px] max-sm:w-full" />
        </div>
        <div class="p-5 @container">
          <div class="mb-[6px] hidden h-6 grid-cols-5 gap-3 @min-[1000px]:grid">
            <qa-skeleton class="col-span-2 h-2.5 w-20 self-center" />
            <qa-skeleton class="col-span-3 h-2.5 w-20 self-center" />
          </div>
          <div class="hidden h-[34px] grid-cols-5 gap-3 @min-[1000px]:grid">
            @for (i of steps; track i) {
              <qa-skeleton class="size-[18px] rounded-full" />
            }
          </div>
          <div
            class="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[700px]:grid-cols-3 @min-[1000px]:grid-cols-5"
          >
            @for (i of steps; track i) {
              <div
                class="flex min-h-[164px] flex-col gap-2.5 rounded-[10px] border border-(--border) bg-(--surface-2) p-[14px]"
              >
                <qa-skeleton class="h-2.5 w-12" />
                <qa-skeleton class="h-3.5 w-[85%]" />
                <qa-skeleton class="h-3.5 w-[60%]" />
                <qa-skeleton class="mt-1 h-3 w-24" />
              </div>
            }
          </div>
        </div>
      </section>

      <div class="flex flex-col">
        <div class="mb-4 flex flex-wrap items-end gap-4">
          <div class="flex min-w-0 flex-[1_1_15rem] flex-col gap-2">
            <qa-skeleton class="h-5 w-36" />
            <qa-skeleton class="h-3 w-[min(100%,32rem)]" />
          </div>
          <qa-skeleton class="h-9 w-[150px] rounded-[8px] max-sm:w-full" />
        </div>
        <div class="mb-4 flex gap-5 border-b border-(--border) pb-2.5">
          <qa-skeleton class="h-3.5 w-14" />
          <qa-skeleton class="h-3.5 w-16" />
        </div>
        <div class="h-[220px] rounded-[12px] border border-(--border) bg-(--surface) p-5">
          <qa-skeleton class="h-4 w-56" />
          <qa-skeleton class="mt-2 h-3 w-80 max-w-full" />
        </div>
      </div>
    </qa-loading>
  `,
})
export class CycleSkeleton {
  protected readonly steps = STEPS;
}
