import { Component, ElementRef, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { FormField, form, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { SpApi } from '../../core/api/sp-api';
import { SP_ERROR, SP_TEXT_MAX, SpRespondAnswer, SpRespondBody, SpResponse, SpResponseKind } from '../../core/api/sp.models';
import { ApiError, toApiError } from '../../core/http/api-envelope';
import { QaButtonImports } from '../../ui';
import { RESPONSE_OPTIONS, charCount } from './sp-format';

interface Draft {
  kind: SpResponseKind | '';
  body: string;
}

function draftFrom(response: SpResponse | null): Draft {
  return { kind: response?.kind ?? '', body: response?.body ?? '' };
}

const NEEDS_TEXT_MESSAGE: Readonly<Record<Exclude<SpResponseKind, 'accept'>, string>> = {
  accept_with_comment: 'Write your comment.',
  disagree: 'Explain why you disagree.',
  request_clarification: 'Write what you want the assessor to clarify.',
};

/**
 * The program's answer to one QA comment (P2-3911 AC7–AC9): Accept, Accept with comment, Disagree or
 * Request clarification. Every kind but Accept needs a text of 1 to 2,000 characters; Accept sends no
 * body at all. On success it hands the server's comment and counts to the page (`saved`).
 */
@Component({
  selector: 'qa-sp-response-form',
  imports: [FormField, QaButtonImports],
  host: { class: 'block' },
  template: `
    <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); submit()" novalidate>
      <fieldset #kindGroup class="m-0 flex flex-col gap-2 border-0 p-0" [attr.aria-describedby]="kindError() ? ids.kindError : null">
        <legend class="mb-1 p-0 text-(length:--fs-13) font-medium text-(--text-2)">Your response</legend>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          @for (o of options; track o.kind) {
            @let on = f.kind().value() === o.kind;
            <label
              class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 focus-within:shadow-(--focus-ring)"
              [class]="on ? 'border-(--primary) bg-(--tint)' : 'border-(--border) bg-(--surface) hover:border-(--border-strong)'"
            >
              <input
                type="radio"
                class="mt-0.5 size-4 flex-none accent-(--primary)"
                [name]="ids.group"
                [value]="o.kind"
                [checked]="on"
                (change)="choose(o.kind)"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-(length:--fs-13) font-semibold text-(--text)">{{ o.label }}</span>
                <span class="text-(length:--fs-12) text-(--text-4)">{{ o.hint }}</span>
              </span>
            </label>
          }
        </div>
        <!-- Always in the DOM so the alert is announced when the message appears. -->
        <p [id]="ids.kindError" aria-live="assertive" aria-atomic="true" class="m-0 text-(length:--fs-12) text-(--danger) empty:hidden">{{ kindError() ?? '' }}</p>
      </fieldset>

      @if (needsText()) {
        <div class="flex flex-col gap-1.5">
          <label [for]="ids.body" class="text-(length:--fs-13) font-medium text-(--text-2)">{{ bodyLabel() }}</label>
          <textarea
            #bodyBox
            [id]="ids.body"
            [formField]="f.body"
            rows="4"
            aria-required="true"
            [attr.aria-invalid]="bodyError() ? true : null"
            [attr.aria-describedby]="ids.counter + (bodyError() ? ' ' + ids.bodyError : '')"
            class="box-border w-full resize-y rounded-lg border bg-(--field-bg) px-3 py-2 text-(length:--fs-14) text-(--text) outline-none placeholder:text-(--text-muted) focus-visible:shadow-(--focus-ring)"
            [class]="bodyError() ? 'border-(--danger)' : 'border-(--border) focus-visible:border-(--primary)'"
          ></textarea>
          <div class="flex items-start justify-between gap-3">
            @if (bodyError(); as message) {
              <p [id]="ids.bodyError" class="m-0 text-(length:--fs-12) text-(--danger)">{{ message }}</p>
            } @else {
              <span></span>
            }
            <span [id]="ids.counter" class="flex-none font-(family-name:--qa-mono) text-(length:--fs-12) tabular-nums" [class]="over() ? 'text-(--danger)' : 'text-(--text-4)'">
              {{ length() }} / {{ max }}<span class="sr-only"> characters</span>
            </span>
          </div>
        </div>
      }

      @if (refusal(); as message) {
        <p class="m-0 rounded-lg border border-(--danger-soft) bg-(--danger-bg) px-3 py-2 text-(length:--fs-13) text-(--danger-strong)" role="alert">{{ message }}</p>
      }

      <div class="flex flex-wrap items-center gap-2">
        <button hlmBtn qaBtn tone="primary" size="sm" type="submit" [loading]="saving()">Save response</button>
        @if (cancellable()) {
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [disabled]="saving()" (click)="cancelled.emit()">Cancel</button>
        }
      </div>
    </form>
  `,
})
export class SpResponseForm {
  private static nextId = 0;
  private readonly api = inject(SpApi);

  readonly commentId = input.required<number>();
  /** The latest response: the form starts from it when changing an answer. */
  readonly current = input<SpResponse | null>(null);
  readonly cancellable = input(false);

  readonly saved = output<SpRespondAnswer>();
  /** 409 `SP_STEP_CLOSED`: the page reloads read-only. */
  readonly stepClosed = output<ApiError>();
  /** 404: the comment is no longer visible; the page reloads. */
  readonly gone = output<ApiError>();
  readonly cancelled = output();

  private readonly uid = SpResponseForm.nextId++;
  protected readonly ids = {
    group: `sp-response-kind-${this.uid}`,
    kindError: `sp-response-kind-error-${this.uid}`,
    body: `sp-response-body-${this.uid}`,
    bodyError: `sp-response-body-error-${this.uid}`,
    counter: `sp-response-counter-${this.uid}`,
  };
  protected readonly options = RESPONSE_OPTIONS;
  protected readonly max = SP_TEXT_MAX;

  private readonly bodyBox = viewChild<ElementRef<HTMLTextAreaElement>>('bodyBox');
  private readonly kindGroup = viewChild<ElementRef<HTMLFieldSetElement>>('kindGroup');

  /**
   * Starts from the latest answer, if any (changing a response keeps its text at hand). When the page
   * reloads because another comment's save got 404/409, this unsaved draft stays while this comment's
   * latest response is the same on the server.
   */
  private readonly draft = linkedSignal<SpResponse | null, Draft>({
    source: () => this.current(),
    computation: (response, previous) => (previous && previous.source?.id === response?.id ? previous.value : draftFrom(response)),
  });
  protected readonly f = form(this.draft, (p) => {
    validate(p.kind, ({ value }) => (value() ? undefined : { kind: 'required', message: 'Choose a response.' }));
    validate(p.body, ({ value, valueOf }) => {
      const kind = valueOf(p.kind);
      if (kind === '' || kind === 'accept') return undefined;
      const text = value().trim();
      if (!text) return { kind: 'required', message: NEEDS_TEXT_MESSAGE[kind] };
      if (charCount(text) > SP_TEXT_MAX) return { kind: 'maxLength', message: `Keep it to ${SP_TEXT_MAX} characters or fewer.` };
      return undefined;
    });
  });

  protected readonly saving = signal(false);
  private readonly tried = signal(false);
  /** A server refusal shown above the button (not a field rule). */
  protected readonly refusal = signal<string | null>(null);
  /** A 400 on `body` from the server. */
  private readonly serverBodyError = signal<string | null>(null);

  protected readonly needsText = computed(() => {
    const kind = this.f.kind().value();
    return kind !== '' && kind !== 'accept';
  });
  protected readonly bodyLabel = computed(() => {
    const kind = this.f.kind().value();
    return kind === 'request_clarification' ? 'Your question' : kind === 'disagree' ? 'Why you disagree' : 'Your comment';
  });
  /** Counted as it is sent and validated: trimmed. */
  protected readonly length = computed(() => charCount(this.f.body().value().trim()));
  protected readonly over = computed(() => this.length() > SP_TEXT_MAX);

  protected readonly kindError = computed(() => (this.tried() ? (this.f.kind().errors()[0]?.message ?? null) : null));
  protected readonly bodyError = computed(() => {
    if (this.serverBodyError()) return this.serverBodyError();
    if (this.over()) return this.f.body().errors()[0]?.message ?? null;
    return this.tried() || this.f.body().touched() ? (this.f.body().errors()[0]?.message ?? null) : null;
  });

  protected choose(kind: SpResponseKind): void {
    this.f.kind().value.set(kind);
    this.refusal.set(null);
    this.serverBodyError.set(null);
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.tried.set(true);
    this.refusal.set(null);
    this.serverBodyError.set(null);
    if (this.f().invalid()) {
      if (this.f.kind().invalid()) {
        this.focusKind();
        return;
      }
      this.bodyBox()?.nativeElement.focus();
      return;
    }
    const { kind, body } = this.draft();
    if (kind === '') return;
    const request: SpRespondBody = kind === 'accept' ? { kind } : { kind, body: body.trim() };
    this.saving.set(true);
    try {
      const answer = await firstValueFrom(this.api.respond(this.commentId(), request));
      this.tried.set(false);
      this.saved.emit(answer);
    } catch (error) {
      this.handle(toApiError(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** This save failed and the page reloads: drop the draft, show what the server has. */
  private followServer(): void {
    this.draft.set(draftFrom(this.current()));
    this.tried.set(false);
  }

  /** The radio group: the checked option, else the first one. */
  private focusKind(): void {
    const group = this.kindGroup()?.nativeElement;
    const radio = group?.querySelector<HTMLInputElement>('input[type=radio]:checked') ?? group?.querySelector<HTMLInputElement>('input[type=radio]');
    radio?.focus();
  }

  private handle(error: ApiError): void {
    if (error.code === SP_ERROR.STEP_CLOSED) {
      this.followServer();
      this.stepClosed.emit(error);
      return;
    }
    if (error.status === 404) {
      this.followServer();
      this.gone.emit(error);
      return;
    }
    if (error.code === SP_ERROR.COMMENT_NOT_RESPONDABLE) {
      this.refusal.set(error.message);
      return;
    }
    if (error.status === 400) {
      const field = error.fieldMessage('body');
      if (field && this.needsText()) {
        this.serverBodyError.set(field);
        this.bodyBox()?.nativeElement.focus();
        return;
      }
      this.refusal.set(error.fieldMessage('kind') ?? error.message);
      return;
    }
    // 401 ends the SP session (SpApi); anything else is shown as the catalog text.
    if (error.status !== 401) this.refusal.set(error.message);
  }
}
