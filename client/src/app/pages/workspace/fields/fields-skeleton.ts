import { Component, input } from '@angular/core';
import { QaLoadingImports, skeletonRows } from '../../../ui';
import { FieldsColumnHeader } from './fields-column-header';

/** Name widths of the placeholder rows, so the column does not read as a solid block. */
const NAME_WIDTHS = [
  'w-28',
  'w-24',
  'w-36',
  'w-32',
  'w-44',
  'w-40',
  'w-72',
  'w-56',
  'w-80',
  'w-52',
];

/**
 * Fields matrix while it loads: same frame, column header, section bar and row grid as the real one,
 * with 10 placeholder rows. Wide and compact follow the real layouts.
 */
@Component({
  selector: 'qa-fields-skeleton',
  imports: [QaLoadingImports, FieldsColumnHeader],
  host: { class: 'block' },
  template: `
    <qa-loading label="Loading the fields" class="block">
      <div class="relative overflow-hidden rounded-xl border border-(--border) bg-(--surface)">
        @if (!compact()) {
          <qa-fields-column-header />
        }
        <!-- Section bar -->
        <div
          class="flex min-h-10 items-center gap-2.5 border-b border-(--surface-4) bg-(--surface-2) px-5"
        >
          <qa-skeleton class="size-3.5 rounded-[4px]" />
          <qa-skeleton class="h-3 w-40" />
          <qa-skeleton class="ml-auto h-3 w-24" />
        </div>
        @for (i of rows; track i) {
          @if (compact()) {
            <div
              class="flex flex-col gap-2.5 border-b border-(--surface-4) px-5 py-[14px] last:border-b-0"
            >
              <qa-skeleton class="h-3.5" [class]="names[i]" />
              <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
                <qa-skeleton class="h-10 min-w-[min(100%,22rem)] flex-1 rounded-[8px]" />
                @for (sw of switches; track sw) {
                  <div class="flex min-h-10 items-center gap-2">
                    <qa-skeleton class="h-2.5" [class]="sw" />
                    <qa-skeleton class="h-[18px] w-8 rounded-full" />
                  </div>
                }
              </div>
            </div>
          } @else {
            <div
              class="grid min-h-[52px] grid-cols-[minmax(0,1fr)_352px_64px_64px_28px] items-center gap-4 border-b border-(--surface-4) px-5 last:border-b-0"
            >
              <div class="flex flex-col gap-1.5 py-2">
                <qa-skeleton class="h-3.5" [class]="names[i]" />
                @if (i % 3 === 1) {
                  <qa-skeleton class="h-2.5 w-16" />
                }
              </div>
              <qa-skeleton class="h-[30px] w-[198px] rounded-[8px]" />
              <qa-skeleton class="h-[18px] w-8 justify-self-center rounded-full" />
              <qa-skeleton class="h-[18px] w-8 justify-self-center rounded-full" />
              <span></span>
            </div>
          }
        }
      </div>
    </qa-loading>
  `,
})
export class FieldsSkeleton {
  readonly compact = input(false);
  protected readonly rows = skeletonRows();
  protected readonly names = NAME_WIDTHS;
  /** Widths of the CORE and AI labels next to the switches (compact). */
  protected readonly switches = ['w-8', 'w-4'];
}
