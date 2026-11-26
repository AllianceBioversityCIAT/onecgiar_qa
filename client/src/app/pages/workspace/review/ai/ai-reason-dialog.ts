import {
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { HlmInput } from '@spartan/input';
import { QaButtonImports, QaDialogImports } from '../../../../ui';
import { AI_REASON_MAX, reasonError } from './ai-reason';

/**
 * Asks for the one-line reason before validating IRL / IUL 2+ levels above the AI (FR-10). Save emits the
 * trimmed reason and the dialog stays open: the page posts it (`busy` meanwhile), closes the dialog once the
 * server stored it, or passes `error` and the reason stays for a retry. Cancel, Esc or the X saves nothing.
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
      <label for="ai-reason" class="text-(length:--fs-13) font-medium text-(--text-2)"
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
        [readOnly]="busy()"
        [attr.aria-invalid]="touched() && error() ? true : null"
        [attr.aria-describedby]="
          failure() || (touched() && error()) ? 'ai-reason-err' : 'ai-reason-count'
        "
        class="h-9 w-full rounded-lg border-(--border) bg-(--field-bg) px-3 py-0 text-(length:--fs-14) text-(--text) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-14) dark:bg-(--field-bg)"
        placeholder="e.g. The annex reports a second pilot in Uganda"
      />
      <div class="flex items-center justify-between gap-3">
        @if (failure()) {
          <p
            id="ai-reason-err"
            role="alert"
            class="m-0 text-(length:--fs-12) text-(--danger-strong)"
          >
            {{ failure() }}
          </p>
        } @else if (touched() && error(); as e) {
          <p id="ai-reason-err" class="m-0 text-(length:--fs-12) text-(--danger-strong)">{{ e }}</p>
        } @else {
          <span></span>
        }
        <span id="ai-reason-count" class="text-(length:--fs-12) text-(--text-3)"
          >{{ reason().trim().length }}/{{ max }}</span
        >
      </div>
      <div qaDialogFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" [disabled]="busy()" (click)="cancel()">
          Cancel
        </button>
        <button
          hlmBtn
          qaBtn
          tone="primary"
          type="button"
          [loading]="busy()"
          [disabled]="error() !== null || busy()"
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
  /** The page is posting the reason: Save spins, nothing else can be pressed. */
  readonly busy = input(false);
  /** Why the last Save did not go through (the reason stays in the box). */
  readonly failure = input('');
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

  constructor() {
    // However it closes (Save, Cancel, Esc, a click outside, the X), the next opening starts empty.
    effect(() => {
      if (!this.open()) untracked(() => this.reason.set(''));
    });
  }

  protected save(): void {
    if (this.error() !== null || this.busy()) return;
    this.confirmed.emit(this.reason().trim());
  }

  protected cancel(): void {
    this.reason.set('');
    this.open.set(false);
    this.cancelled.emit();
  }
}
