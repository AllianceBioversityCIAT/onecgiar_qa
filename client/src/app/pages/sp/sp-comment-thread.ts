import { DatePipe } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { SP_RESPONDABLE_STATES, SpComment, SpRespondAnswer } from '../../core/api/sp.models';
import { ApiError } from '../../core/http/api-envelope';
import { QaBadge, QaBadgeStatus, QaButtonImports } from '../../ui';
import { SpFieldValue } from './sp-field-value';
import { responseKindLabel, sameValue } from './sp-format';
import { SpResponseForm } from './sp-response-form';

const DATE_TIME = 'd MMM y, HH:mm';

/**
 * One QA comment as the program sees it (P2-3911 AC6–AC11): the text and its date (never who wrote
 * it), the value when it was written if it changed since, the latest response, the clarifications,
 * the response history, and the response form while the programs step is open.
 */
@Component({
  selector: 'qa-sp-comment-thread',
  imports: [DatePipe, QaBadge, QaButtonImports, SpFieldValue, SpResponseForm],
  host: { class: 'flex flex-col gap-3 rounded-[10px] border border-(--border) bg-(--surface) px-4 py-3.5' },
  template: `
    @let c = comment();
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-(length:--fs-12) font-semibold tracking-[0.04em] text-(--text-3) uppercase">QA comment</span>
      <span class="text-(length:--fs-12) text-(--text-4)">{{ c.createdAt | date: dateTime }}</span>
      <qa-badge class="ml-auto" size="sm" [status]="stateTone()">{{ stateLabel() }}</qa-badge>
    </div>
    <p class="m-0 text-(length:--fs-14) leading-[1.5] whitespace-pre-line text-(--text)">{{ c.body }}</p>

    @if (valueChanged()) {
      <details class="rounded-lg bg-(--surface-3) px-3 py-2">
        <summary class="cursor-pointer text-(length:--fs-12) font-medium text-(--text-3)">Value when the comment was written</summary>
        <div class="pt-2">
          <qa-sp-field-value [value]="c.valueCopy.value" [labels]="c.valueCopy.labels ?? null" />
          @if (c.valueTruncated) {
            <p class="m-0 pt-1 text-(length:--fs-12) text-(--text-4)">Shortened: the value was too long to keep in full.</p>
          }
        </div>
      </details>
    }

    <div #responseBox tabindex="-1" class="flex flex-col gap-1 rounded-lg border-l-[3px] px-3 py-2 outline-none focus-visible:shadow-(--focus-ring)" [class]="c.response ? 'border-l-(--primary) bg-(--tint)' : 'border-l-(--border-strong) bg-(--surface-3)'">
      @if (c.response; as r) {
        <span class="text-(length:--fs-13) font-semibold text-(--text)">{{ kindLabel(r.kind) }}</span>
        @if (r.body) {
          <p class="m-0 text-(length:--fs-13) leading-[1.5] whitespace-pre-line text-(--text-2)">{{ r.body }}</p>
        }
        <span class="text-(length:--fs-12) text-(--text-4)">by {{ r.respondedBy.name }} · {{ r.respondedAt | date: dateTime }}</span>
      } @else {
        <span class="text-(length:--fs-13) text-(--text-3)">No response yet.</span>
      }
    </div>

    @if (c.state === 'clarification_requested') {
      <p class="m-0 text-(length:--fs-13) font-medium text-(--st-editing-fg)">Clarification requested — waiting for the assessor.</p>
    }

    @if (c.clarifications.length) {
      <div class="flex flex-col gap-2">
        <span class="text-(length:--fs-12) font-semibold text-(--text-3)">Clarifications</span>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          @for (q of c.clarifications; track q.requestId) {
            <li class="flex flex-col gap-1 rounded-lg border border-(--border-soft) px-3 py-2">
              <span class="text-(length:--fs-12) text-(--text-4)">Your question · {{ q.requestedAt | date: dateTime }}</span>
              <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-2)">{{ q.question }}</p>
              @if (q.answer; as a) {
                <span class="pt-1 text-(length:--fs-12) text-(--text-4)">Assessor's answer · {{ a.answeredAt | date: dateTime }}</span>
                <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-2)">{{ a.body }}</p>
              } @else {
                <span class="text-(length:--fs-12) text-(--text-4) italic">Waiting for the assessor's answer.</span>
              }
            </li>
          }
        </ul>
      </div>
    }

    @if (c.history.length > 1) {
      <details>
        <summary class="cursor-pointer text-(length:--fs-12) font-medium text-(--text-3)">Response history ({{ c.history.length }})</summary>
        <ol class="m-0 flex list-none flex-col gap-2 p-0 pt-2">
          @for (h of c.history; track h.id) {
            <li class="flex flex-col gap-0.5 border-l-2 border-(--border) pl-3">
              <span class="text-(length:--fs-13) font-medium text-(--text-2)">{{ kindLabel(h.kind) }}</span>
              @if (h.body) {
                <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-3)">{{ h.body }}</p>
              }
              <span class="text-(length:--fs-12) text-(--text-4)">by {{ h.respondedBy.name }} · {{ h.respondedAt | date: dateTime }}</span>
            </li>
          }
        </ol>
      </details>
    }

    <p class="sr-only" aria-live="polite">{{ notice() }}</p>

    @if (writable()) {
      @if (!respondable()) {
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">This comment can no longer be answered.</p>
      } @else if (editing()) {
        <qa-sp-response-form
          [commentId]="c.id"
          [current]="c.response"
          [cancellable]="!!c.response"
          (saved)="onSaved($event)"
          (stepClosed)="stepClosed.emit($event)"
          (gone)="gone.emit($event)"
          (cancelled)="editing.set(false)"
        />
      } @else {
        <div>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="editing.set(true)">Change response</button>
        </div>
      }
    }
  `,
})
export class SpCommentThread {
  readonly comment = input.required<SpComment>();
  /** The field's value now, to tell whether it changed since the comment. */
  readonly fieldValue = input<unknown>(null);
  readonly writable = input(false);

  readonly saved = output<SpRespondAnswer>();
  readonly stepClosed = output<ApiError>();
  readonly gone = output<ApiError>();

  private readonly injector = inject(Injector);
  private readonly responseBox = viewChild<ElementRef<HTMLElement>>('responseBox');
  protected readonly dateTime = DATE_TIME;

  /** Unanswered comments show the form at once; answered ones behind "Change response". */
  protected readonly editing = linkedSignal(() => this.comment().response === null);
  protected readonly notice = signal('');

  protected readonly respondable = computed(() => SP_RESPONDABLE_STATES.includes(this.comment().state));
  protected readonly valueChanged = computed(() => !sameValue(this.comment().valueCopy.value, this.fieldValue()));

  protected readonly stateLabel = computed(() => {
    const c = this.comment();
    if (c.state === 'clarification_requested') return 'Clarification requested';
    if (c.response) return 'Answered';
    if (c.state === 'open') return 'Awaiting response';
    return 'Closed';
  });
  protected readonly stateTone = computed<QaBadgeStatus>(() => {
    const c = this.comment();
    if (c.state === 'clarification_requested') return 'awaiting';
    if (c.response) return 'answered';
    return c.state === 'open' ? 'pending' : 'neutral';
  });

  protected kindLabel(kind: string): string {
    return responseKindLabel(kind);
  }

  protected onSaved(answer: SpRespondAnswer): void {
    this.saved.emit(answer);
    this.editing.set(false);
    this.notice.set(`Response saved: ${responseKindLabel(answer.comment.response?.kind ?? '')}.`);
    // The form is gone: focus lands on the saved response, not on the page top.
    afterNextRender(() => this.responseBox()?.nativeElement.focus(), { injector: this.injector });
  }
}
