import { Component, input } from '@angular/core';
import { QaTooltipImports } from '../../../ui';
import { FIELD_HEAD_HELP } from './fields.mock';

/** Sticky column header of the Fields matrix (wide layout only) with the ⓘ help of each column. */
@Component({
  selector: 'qa-fields-column-header',
  imports: [QaTooltipImports],
  host: { class: 'contents' },
  template: `
    <div
      class="sticky top-0 z-12 grid h-10 grid-cols-[minmax(0,1fr)_352px_64px_64px_28px] items-center gap-4 border-b border-(--border) bg-(--surface-3) px-5 text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase"
      [class]="stuck() ? 'rounded-none shadow-[0_1px_0_var(--border)]' : 'rounded-t-[11px]'"
    >
      <span>Field</span>
      @for (head of heads; track head.label) {
        <span class="flex items-center gap-1 whitespace-nowrap" [class]="head.align === 'start' ? 'justify-start' : 'justify-center'">
          <span>{{ head.label }}</span>
          <ng-template #tip>
            @if (head.items) {
              <span class="text-(length:--fs-14) font-semibold text-(--text)">{{ head.label }}</span>
              @for (item of head.items; track item.label) {
                <span class="flex min-h-[26px] items-baseline gap-2.5 text-(length:--fs-13) leading-[1.45]"><span class="w-[84px] flex-none font-semibold text-(--text)">{{ item.label }}</span><span class="min-w-0 flex-1 font-normal text-(--text-3)">{{ item.text }}</span></span>
              }
              @if (head.note) {
                <span class="mt-1 border-t border-(--surface-4) pt-2 text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-2)">{{ head.note }}</span>
              }
            } @else {
              {{ head.text }}
            }
          </ng-template>
          <button
            type="button"
            [qaTooltip]="tip"
            [attr.aria-label]="'About ' + head.label"
            class="flex size-[14px] flex-none cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-(--text-muted) hover:text-(--primary) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01"></path></svg>
          </button>
        </span>
      }
      <span></span>
    </div>
  `,
})
export class FieldsColumnHeader {
  readonly stuck = input(false);
  protected readonly heads = FIELD_HEAD_HELP;
}
