import { Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { AiVm } from './review-model';

/** "AI match" note under a field: verdict, reasoning, Use as comment / Not relevant. */
@Component({
  selector: 'qa-review-ai-note',
  imports: [HlmButton],
  host: { class: 'flex flex-col gap-2 rounded-[8px] border border-(--ai-tint-3) bg-(--ai-tint) px-[14px] py-3' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ai)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
      <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--ai) uppercase">AI match</span>
      @if (ai().mismatch) {
        <span class="rounded-full bg-(--st-editing-bg) px-2 py-0.5 text-(length:--fs-11) font-semibold text-(--st-editing-fg)">Possible mismatch</span>
      } @else {
        <span class="rounded-full bg-(--surface-3) px-2 py-0.5 text-(length:--fs-11) font-semibold text-(--text-3)">Looks consistent</span>
      }
      <span class="min-w-0 flex-[1_1_0px]"></span>
      @if (!ai().mismatch) {
        <button
          type="button"
          [attr.aria-label]="ai().expanded ? 'Hide reasoning' : 'Show reasoning'"
          [title]="ai().expanded ? 'Hide reasoning' : 'Show reasoning'"
          [attr.aria-expanded]="ai().expanded"
          class="flex size-5 flex-none items-center justify-center rounded-[6px] p-0 text-(--text-muted) hover:text-(--text-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          (click)="toggle.emit()"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform duration-150" [class.rotate-180]="ai().expanded" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      }
      <button type="button" aria-label="Hide AI match" class="flex size-5 flex-none items-center justify-center rounded-[6px] p-0 text-(--text-muted) hover:text-(--text-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none" (click)="hide.emit()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
    @if (ai().expanded) {
      <div class="text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--text-2)">{{ ai().text }}</div>
    }
    @if (ai().mismatch) {
      <div class="flex items-center gap-2 pt-0.5">
        <button hlmBtn variant="ghost" type="button" class="h-auto min-h-7 gap-1.5 rounded-[8px] border-(color:--ai-tint-3) bg-(color:--surface) px-2.5 text-(length:--fs-12) font-semibold text-(color:--ai) hover:bg-(color:--ai-tint-2) hover:text-(color:--ai) focus-visible:border-(color:--ai-tint-3) focus-visible:shadow-(--focus-ring) focus-visible:ring-0 active:translate-y-0 dark:hover:bg-(color:--ai-tint-2)" (click)="useAsComment.emit()">Use as comment</button>
        <button hlmBtn variant="ghost" type="button" class="h-auto min-h-7 rounded-[8px] px-2 text-(length:--fs-12) font-medium text-(color:--text-4) hover:bg-(color:--surface-3) hover:text-(color:--text-4) focus-visible:shadow-(--focus-ring) focus-visible:ring-0 active:translate-y-0 dark:hover:bg-(color:--surface-3)" (click)="dismiss.emit()">Not relevant</button>
      </div>
    }
  `,
})
export class ReviewAiNote {
  readonly ai = input.required<AiVm>();
  readonly toggle = output();
  readonly hide = output();
  readonly dismiss = output();
  readonly useAsComment = output();
}
