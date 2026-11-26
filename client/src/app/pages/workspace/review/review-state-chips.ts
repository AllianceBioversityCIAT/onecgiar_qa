import { Component, input } from '@angular/core';
import { StateChip } from './review-model';

/**
 * Field review state ("Approved", "Commented 1", "Answered", "Highlighted", the TPB decision, "Changes done", "Not reviewed").
 * Same language as every status in the app: a neutral badge whose colour is only in its dot (direction A, Juanpa
 * 2026-11-25). Field properties (Core, View only, Context) are outlined tags instead, so state and property never mix.
 */
@Component({
  selector: 'qa-review-state-chips',
  host: { class: 'contents' },
  template: `
    @for (chip of states(); track chip.kind) {
      @switch (chip.kind) {
        @case ('not') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--border-strong)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('ok') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--success)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('com') {
          <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--warning)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}<span class="tabular-nums text-(--text-3)">{{ chip.count }}</span></span>
        }
        @case ('ans') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--st-submitted-fg)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('hl') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--danger)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('agreed') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--text-4)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('changes') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--warning)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
        @case ('done') { <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2) [--qa-dot:var(--success)]"><span aria-hidden="true" class="size-1.5 flex-none rounded-full bg-(--qa-dot)"></span>{{ chip.label }}</span> }
      }
    }
    @if (answeredDate()) {
      <span class="ml-auto text-(length:--fs-12) font-normal text-(--text-4)">Updated in the reporting tool · <span class="font-medium tabular-nums">{{ answeredDate() }}</span></span>
    }
  `,
})
export class ReviewStateChips {
  readonly states = input.required<readonly StateChip[]>();
  readonly answeredDate = input('');
}
