import { Component, input } from '@angular/core';
import { QaTooltipImports } from '../../../ui';

/** ⓘ next to the result code: science program, timeline, step, assessor, submitted. */
@Component({
  selector: 'qa-review-code-info',
  imports: [QaTooltipImports],
  host: { class: 'contents' },
  template: `
    <button type="button" [qaTooltip]="info" aria-label="Result details" class="flex size-[18px] flex-none items-center justify-center rounded-full p-0 text-(--text-muted) hover:text-(--primary) focus-visible:shadow-(--focus-ring) focus-visible:outline-none">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg>
    </button>
    <ng-template #info>
      <dl class="m-0 flex w-[256px] max-w-full flex-col">
        @for (row of details(); track row.label; let last = $last) {
          <div class="flex min-h-[30px] items-center gap-3 border-b" [class]="last ? 'border-transparent' : 'border-(--surface-4)'">
            <dt class="w-24 flex-none text-(length:--fs-13) font-normal text-(--text-4)">{{ row.label }}</dt>
            <dd class="m-0 min-w-0 flex-1 text-(length:--fs-13) font-medium text-(--text-2)">{{ row.value }}</dd>
          </div>
        }
      </dl>
    </ng-template>
  `,
})
export class ReviewCodeInfo {
  readonly details = input.required<readonly { readonly label: string; readonly value: string }[]>();
}
