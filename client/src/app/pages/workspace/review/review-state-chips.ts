import { Component, input } from '@angular/core';
import { StateChip } from './review-model';

/** Field review state ("Approved", "Commented 1", "Answered", "Highlighted", "Not reviewed"). */
@Component({
  selector: 'qa-review-state-chips',
  host: { class: 'contents' },
  template: `
    @for (chip of states(); track chip.kind) {
      <span class="inline-flex items-center gap-[5px]">
        @switch (chip.kind) {
          @case ('not') {
            <span class="box-border size-[11px] flex-none rounded-full border-[1.5px] border-(--border-strong)" aria-hidden="true"></span>
            <span class="text-(length:--fs-11) font-semibold text-(--text-muted)">{{ chip.label }}</span>
          }
          @case ('ok') {
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--st-approved-fg)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
            <span class="text-(length:--fs-11) font-semibold text-(--st-approved-fg)">{{ chip.label }}</span>
          }
          @case ('com') {
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--st-editing-fg)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span class="text-(length:--fs-11) font-semibold text-(--st-editing-fg)">{{ chip.label }}</span>
            <span class="font-(family-name:--qa-mono) text-(length:--fs-11) font-bold text-(--st-editing-fg) tabular-nums">{{ chip.count }}</span>
          }
          @case ('ans') {
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--st-submitted-fg)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8.5 10l2.5 2.5 4.5-4.5" /></svg>
            <span class="text-(length:--fs-11) font-semibold text-(--st-submitted-fg)">{{ chip.label }}</span>
          }
          @case ('hl') {
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" /></svg>
            <span class="text-(length:--fs-11) font-semibold text-(--danger)">{{ chip.label }}</span>
          }
        }
      </span>
    }
    @if (answeredDate()) {
      <span class="ml-auto text-(length:--fs-11) font-normal text-(--text-4)">Updated in the reporting tool · <span class="font-(family-name:--qa-mono) font-medium tabular-nums">{{ answeredDate() }}</span></span>
    }
  `,
})
export class ReviewStateChips {
  readonly states = input.required<readonly StateChip[]>();
  readonly answeredDate = input('');
}
