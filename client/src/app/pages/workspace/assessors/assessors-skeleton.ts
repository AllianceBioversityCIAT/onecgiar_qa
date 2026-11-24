import { Component } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../../ui';
import { CELL } from './assessors-table';

/** Name widths of the placeholder people, so the column does not read as a solid block. */
const NAMES = ['w-32', 'w-40', 'w-28', 'w-36', 'w-44', 'w-28', 'w-40', 'w-32', 'w-36', 'w-24'];

/** Team table while it loads: same frame, header and responsive row grid (`CELL`) as the real table, 10 rows. */
@Component({
  selector: 'qa-assessors-skeleton',
  imports: [QaLoadingImports],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading the team" class="block">
      <div class="@container overflow-hidden rounded-xl border border-(--border) bg-(--surface)">
        <div
          class="hidden h-10 grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,210px)_32px] items-center gap-3 border-b border-(--border) bg-(--surface-3) px-5 @min-[640px]:grid @min-[950px]:grid-cols-[minmax(0,1fr)_160px_220px_260px_32px]"
        >
          <qa-skeleton class="h-2.5 w-14" />
          <qa-skeleton class="hidden h-2.5 w-10 @min-[950px]:block" />
          <qa-skeleton class="h-2.5 w-20" />
          <qa-skeleton class="h-2.5 w-16" />
        </div>
        @for (i of rows; track i) {
          <div [class]="cell.row + (i < rows.length - 1 ? ' border-b border-(--surface-4)' : '')">
            <div class="flex min-w-0 items-center gap-2.5" [class]="cell.person">
              <qa-skeleton class="size-7 flex-none rounded-full" />
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <qa-skeleton class="h-3.5" [class]="names[i]" />
                <qa-skeleton class="h-2.5 w-44 max-w-full" />
                <qa-skeleton class="h-2.5 w-28" />
              </div>
            </div>
            <div [class]="cell.role"><qa-skeleton class="h-7 w-24 rounded-[6px]" /></div>
            <div [class]="cell.types"><qa-skeleton class="h-7 w-32 rounded-[6px]" /></div>
            <div class="flex flex-col gap-2" [class]="cell.progress">
              <qa-skeleton class="h-2.5 w-[70%]" />
              <qa-skeleton class="h-1 w-full rounded-full" />
            </div>
            <div [class]="cell.menu"><qa-skeleton class="size-6 rounded-md" /></div>
          </div>
        }
      </div>
    </qa-loading>
  `,
})
export class AssessorsSkeleton {
  protected readonly rows = skeletonRows();
  protected readonly names = NAMES;
  protected readonly cell = CELL;
}
