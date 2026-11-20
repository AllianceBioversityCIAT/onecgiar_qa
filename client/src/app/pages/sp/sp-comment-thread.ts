import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  SP_RESPONDABLE_STATES,
  SpComment,
  SpRespondAnswer,
  SpResponse,
} from '../../core/api/sp.models';
import { ApiError } from '../../core/http/api-envelope';
import { QaBadge, QaBadgeStatus, QaButtonImports } from '../../ui';
import { SpFieldValue } from './sp-field-value';
import { responseKindLabel, romeMoment, sameValue } from './sp-format';
import { SpResponseForm } from './sp-response-form';

/**
 * One QA comment as the program sees it (P2-3911 AC6–AC11): the text and its date (never who wrote
 * it), the value when it was written if it changed since, the latest response, the clarifications,
 * the response history, and the response form while the programs step is open.
 */
@Component({
  selector: 'qa-sp-comment-thread',
  imports: [QaBadge, QaButtonImports, SpFieldValue, SpResponseForm],
  host: {
    class: 'flex flex-col gap-3 rounded-[10px] border border-(--border) bg-(--surface) px-4 py-3.5',
  },
  template: `
    @let c = comment();
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-(length:--fs-12) font-semibold tracking-[0.04em] text-(--text-3) uppercase"
        >QA comment</span
      >
      <span class="text-(length:--fs-12) text-(--text-4)">{{ at(c.createdAt) }}</span>
      <qa-badge class="ml-auto" size="sm" [status]="stateTone()">{{ stateLabel() }}</qa-badge>
    </div>
    <p class="m-0 text-(length:--fs-14) leading-[1.5] whitespace-pre-line text-(--text)">
      {{ c.body }}
    </p>

    @if (valueChanged()) {
      <details class="rounded-lg bg-(--surface-3) px-3 py-2">
        <summary class="cursor-pointer text-(length:--fs-12) font-medium text-(--text-3)">
          Value when the comment was written
        </summary>
        <div class="pt-2">
          <qa-sp-field-value [value]="c.valueCopy.value" [labels]="c.valueCopy.labels ?? null" />
          @if (c.valueTruncated) {
            <p class="m-0 pt-1 text-(length:--fs-12) text-(--text-4)">
              Shortened: the value was too long to keep in full.
            </p>
          }
        </div>
      </details>
    }

    <div
      #responseBox
      tabindex="-1"
      class="flex flex-col gap-1 rounded-lg border-l-[3px] px-3 py-2 outline-none focus-visible:shadow-(--focus-ring)"
      [class]="
        c.response
          ? 'border-l-(--primary) bg-(--tint)'
          : 'border-l-(--border-strong) bg-(--surface-3)'
      "
    >
      @if (c.response; as r) {
        <span class="text-(length:--fs-13) font-semibold text-(--text)">{{
          kindLabel(r.kind)
        }}</span>
        @if (r.body) {
          <p class="m-0 text-(length:--fs-13) leading-[1.5] whitespace-pre-line text-(--text-2)">
            {{ r.body }}
          </p>
        }
        <span class="text-(length:--fs-12) text-(--text-4)"
          >by {{ r.respondedBy.name }} · {{ at(r.respondedAt) }}</span
        >
      } @else {
        <span class="text-(length:--fs-13) text-(--text-3)">No response yet.</span>
      }
    </div>

    @if (c.state === 'clarification_requested') {
      <p class="m-0 text-(length:--fs-13) font-medium text-(--st-editing-fg)">
        Clarification requested — waiting for the assessor.
      </p>
    }

    @if (c.clarifications.length) {
      <div class="flex flex-col gap-2">
        <span class="text-(length:--fs-12) font-semibold text-(--text-3)">Clarifications</span>
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          @for (q of c.clarifications; track q.requestId) {
            <li class="flex flex-col gap-1 rounded-lg border border-(--border-soft) px-3 py-2">
              <span class="text-(length:--fs-12) text-(--text-4)"
                >Your question · {{ at(q.requestedAt) }}</span
              >
              <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-2)">
                {{ q.question }}
              </p>
              @if (q.answer; as a) {
                <span class="pt-1 text-(length:--fs-12) text-(--text-4)"
                  >Assessor's answer · {{ at(a.answeredAt) }}</span
                >
                <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-2)">
                  {{ a.body }}
                </p>
              } @else {
                <span class="text-(length:--fs-12) text-(--text-4) italic"
                  >Waiting for the assessor's answer.</span
                >
              }
            </li>
          }
        </ul>
      </div>
    }

    @if (c.history.length > 1) {
      <details>
        <summary class="cursor-pointer text-(length:--fs-12) font-medium text-(--text-3)">
          Response history ({{ c.history.length }})
        </summary>
        <ol class="m-0 flex list-none flex-col gap-2 p-0 pt-2">
          @for (h of c.history; track h.id) {
            <li class="flex flex-col gap-0.5 border-l-2 border-(--border) pl-3">
              <span class="text-(length:--fs-13) font-medium text-(--text-2)">{{
                kindLabel(h.kind)
              }}</span>
              @if (h.body) {
                <p class="m-0 text-(length:--fs-13) whitespace-pre-line text-(--text-3)">
                  {{ h.body }}
                </p>
              }
              <span class="text-(length:--fs-12) text-(--text-4)"
                >by {{ h.respondedBy.name }} · {{ at(h.respondedAt) }}</span
              >
            </li>
          }
        </ol>
      </details>
    }

    <p class="sr-only" aria-live="polite">{{ notice() }}</p>

    @if (writable()) {
      @if (!respondable()) {
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">
          This comment can no longer be answered.
        </p>
      } @else if (editing()) {
        <qa-sp-response-form
          [commentId]="c.id"
          [current]="c.response"
          [cancellable]="!!c.response"
          (saved)="onSaved($event)"
          (stepClosed)="onFailed(); stepClosed.emit($event)"
          (gone)="onFailed(); gone.emit($event)"
          (cancelled)="editing.set(false)"
        />
      } @else {
        <div>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="editing.set(true)">
            Change response
          </button>
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
  /**
   * Unanswered comments show the form at once; answered ones behind "Change response". A reload of the
   * page (another comment's save got 404/409) keeps an open "Change response" while this comment's
   * latest response is the same on the server.
   */
  protected readonly editing = linkedSignal<SpResponse | null, boolean>({
    source: () => this.comment().response,
    computation: (response, previous) =>
      previous && previous.source?.id === response?.id
        ? previous.value
        : response === null || this.awaitsAfterAnswer(),
  });
  protected readonly notice = signal('');

  protected readonly respondable = computed(() =>
    SP_RESPONDABLE_STATES.includes(this.comment().state),
  );
  protected readonly valueChanged = computed(
    () => !sameValue(this.comment().valueCopy.value, this.fieldValue()),
  );

  /**
   * The assessor answered the program's clarification: the comment is open again and the program's turn
   * (P2-3911 AC11, DD-11). Its latest response is still the request, so it must not read as "Answered".
   */
  private awaitsAfterAnswer(): boolean {
    const c = this.comment();
    return c.state === 'open' && c.response?.kind === 'request_clarification';
  }

  protected readonly stateLabel = computed(() => {
    const c = this.comment();
    if (c.state === 'clarification_requested') return 'Clarification requested';
    if (this.awaitsAfterAnswer()) return 'Clarification answered';
    if (c.response) return 'Answered';
    if (c.state === 'open') return 'Awaiting response';
    return 'Closed';
  });
  protected readonly stateTone = computed<QaBadgeStatus>(() => {
    const c = this.comment();
    if (c.state === 'clarification_requested') return 'awaiting';
    if (this.awaitsAfterAnswer()) return 'pending';
    if (c.response) return 'answered';
    return c.state === 'open' ? 'pending' : 'neutral';
  });

  protected at(moment: string): string {
    return romeMoment(moment);
  }

  /** This comment's save got 404/409 and the page reloads: show what the server has. */
  protected onFailed(): void {
    this.editing.set(this.comment().response === null);
  }

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
