import { Component, computed, input, model, output, signal } from '@angular/core';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaDialogImports } from '../../../../ui';
import { AI_REASON_MAX, reasonError } from './ai-reason';

/**
 * Asks for the one-line reason before validating IRL / IUL 2+ levels above the AI (FR-10). Save emits the
 * trimmed reason; the page then calls `validateWithReason`. Cancel, Esc or the X saves nothing.
 */
@Component({
  selector: 'qa-ai-reason-dialog',
  imports: [QaDialogImports, QaButtonImports, HlmInput],
  template: `
    <qa-dialog
      [(open)]="open"
      title="Why does the reported level hold?"
      [subtitle]="subtitle()"
      width="480px"
    >
      <label for="ai-reason" class="text-(length:--fs-13) font-semibold text-(--text-2)"
        >Reason (one line)</label
      >
      <input
        hlmInput
        id="ai-reason"
        type="text"
        [maxLength]="max"
        [value]="reason()"
        (input)="reason.set($any($event.target).value)"
        (keydown.enter)="$event.preventDefault(); save()"
        [attr.aria-invalid]="touched() && error() ? true : null"
        [attr.aria-describedby]="touched() && error() ? 'ai-reason-err' : 'ai-reason-count'"
        class="h-9 w-full rounded-[8px] border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-14) dark:bg-(--field-bg)"
        placeholder="e.g. The annex reports a second pilot in Uganda"
      />
      <div class="flex items-center justify-between gap-3">
        @if (touched() && error(); as e) {
          <p id="ai-reason-err" class="m-0 text-(length:--fs-12) text-(--danger-strong)">{{ e }}</p>
        } @else {
          <span></span>
        }
        <span id="ai-reason-count" class="text-(length:--fs-12) text-(--text-3)"
          >{{ reason().trim().length }}/{{ max }}</span
        >
      </div>
      <div qaDialogFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="cancel()">Cancel</button>
        <button
          hlmBtn
          qaBtn
          tone="primary"
          type="button"
          [disabled]="error() !== null"
          (click)="save()"
        >
          Save and validate
        </button>
      </div>
    </qa-dialog>
  `,
})
export class AiReasonDialog {
  readonly open = model(false);
  readonly aiLevel = input.required<number>();
  readonly reportedLevel = input.required<number>();
  readonly confirmed = output<string>();
  readonly cancelled = output();

  protected readonly max = AI_REASON_MAX;
  protected readonly reason = signal('');
  protected readonly error = computed(() => reasonError(this.reason()));
  protected readonly touched = computed(() => this.reason() !== '');
  protected readonly subtitle = computed(
    () =>
      `The reported level ${this.reportedLevel()} is 2 or more above the level the AI found in the evidence (${this.aiLevel()}).`,
  );

  protected save(): void {
    if (this.error() !== null) return;
    this.confirmed.emit(this.reason().trim());
    this.reason.set('');
    this.open.set(false);
  }

  protected cancel(): void {
    this.reason.set('');
    this.open.set(false);
    this.cancelled.emit();
  }
}
