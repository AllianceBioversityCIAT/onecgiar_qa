import { Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { FieldActions } from './review-model';

/** Approve / Undo / Add comment (View comments N) row of a field card. */
@Component({
  selector: 'qa-review-card-actions',
  imports: [HlmButton],
  host: { class: 'flex flex-wrap items-center gap-2' },
  template: `
    @if (actions().approve) {
      <button hlmBtn type="button" class="h-auto min-h-8 gap-[7px] rounded-[8px] border-none bg-(color:--primary) px-[14px] text-(length:--fs-13) font-semibold whitespace-nowrap text-(color:--surface) hover:bg-(color:--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0 active:translate-y-0" [attr.aria-label]="'Approve ' + label()" (click)="approve.emit()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>Approve</button>
    }
    @if (actions().undo) {
      <button hlmBtn variant="ghost" type="button" class="h-auto min-h-8 gap-[7px] rounded-[8px] border-(color:--border) bg-(color:--surface) px-[14px] text-(length:--fs-13) font-medium whitespace-nowrap text-(color:--text-3) hover:border-(color:--border-strong) hover:bg-(color:--surface-2) hover:text-(color:--text-3) focus-visible:border-(color:--border) focus-visible:shadow-(--focus-ring) focus-visible:ring-0 active:translate-y-0 dark:hover:bg-(color:--surface-2)" [attr.aria-label]="'Undo approval of ' + label()" (click)="undo.emit()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></svg>Undo</button>
    }
    @if (actions().secondary) {
      <button hlmBtn variant="ghost" type="button" aria-haspopup="dialog" class="h-auto min-h-8 gap-[7px] rounded-[8px] border-(color:--border) bg-(color:--surface) px-[14px] text-(length:--fs-13) font-medium whitespace-nowrap text-(color:--text-2) hover:border-(color:--border-strong) hover:bg-(color:--surface-2) hover:text-(color:--text-2) focus-visible:border-(color:--border) focus-visible:shadow-(--focus-ring) focus-visible:ring-0 active:translate-y-0 dark:hover:bg-(color:--surface-2)" (click)="comment.emit()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>{{ actions().secondaryLabel }}@if (actions().count > 0) {<span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-bold text-(--accent) tabular-nums">{{ actions().count }}</span>}<span class="sr-only"> for {{ label() }}</span></button>
    }
  `,
})
export class ReviewCardActions {
  readonly actions = input.required<FieldActions>();
  /** Field label, for accessible button names. */
  readonly label = input('');
  readonly approve = output();
  readonly undo = output();
  readonly comment = output();
}
