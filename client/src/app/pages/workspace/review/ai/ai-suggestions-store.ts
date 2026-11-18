import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AiSuggestionsApi } from '../../../../core/api/ai-suggestions-api';
import {
  AiSuggestionEvent,
  AiSuggestionView,
  AvailableSuggestionView,
} from '../../../../core/api/ai-suggestions.models';
import {
  AI_NOT_AVAILABLE,
  AI_READ_FAILED_REASON,
  AiChipVm,
  AiReported,
  copyTextOf,
  toAiChipVm,
} from './ai-chip.vm';

export type AiLoadState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The AI suggestions of ONE result (spec assessment/ai-suggestions, DD-6). Provide it on the page that shows
 * the result (`providers: [AiSuggestionsStore]`) and call `load` once the timeline and result are known.
 *
 * Nothing here can block the reviewer (NFR-1): a failed read turns every field into "Suggestion not
 * available", and events are fire-and-forget (a failure is swallowed). The AI never validates or comments:
 * `copied` only hands back the text for the comment box; saving stays the reviewer's action (FR-7, AC6).
 */
@Injectable()
export class AiSuggestionsStore {
  private readonly api = inject(AiSuggestionsApi);

  private readonly key = signal<{ timelineId: number; resultCode: number } | null>(null);
  private readonly views = signal<readonly AiSuggestionView[]>([]);
  private readonly loadState = signal<AiLoadState>('idle');
  /** Suggestions already reported as shown / copied by this page (one event each per suggestion). */
  private readonly shown = new Set<string>();
  private readonly copiedSent = new Set<string>();
  /** Fields whose comment box holds a copied suggestion not saved yet (this result only). */
  private readonly copiedFields = new Set<string>();

  readonly state = this.loadState.asReadonly();
  readonly failed = computed(() => this.loadState() === 'failed');

  /** One chip per AI-input field of the result. A field absent from the map gets no chip. */
  readonly byField = computed<ReadonlyMap<string, AiChipVm>>(
    () => new Map(this.views().map((view) => [view.fieldKey, toAiChipVm(view)])),
  );

  async load(timelineId: number, resultCode: number): Promise<void> {
    // A copy belongs to the result it was made on: the same field key on the next result starts clean. The
    // page reloads the same result after each write; that keeps the copies.
    if (!this.isKey(timelineId, resultCode)) this.copiedFields.clear();
    this.key.set({ timelineId, resultCode });
    this.loadState.set('loading');
    try {
      const views = await firstValueFrom(this.api.list(timelineId, resultCode));
      // A later load for another result wins.
      if (!this.isKey(timelineId, resultCode)) return;
      this.views.set(views);
      this.loadState.set('ready');
    } catch {
      if (!this.isKey(timelineId, resultCode)) return;
      this.views.set([]);
      this.loadState.set('failed');
    }
  }

  /**
   * The chip of a field. When the read failed, an AI-input field the caller knows of shows
   * "Suggestion not available" (AC8); pass `aiInput: true` for those fields. For an indicative field the
   * page passes what was reported (`reported`: the category label, or `reportedUseRows(...)`), shown beside
   * the suggestion.
   */
  chipFor(fieldKey: string, aiInput = false, reported: AiReported = null): AiChipVm | null {
    if (reported !== null) {
      const view = this.views().find((v) => v.fieldKey === fieldKey);
      if (view) return toAiChipVm(view, reported);
    }
    const vm = this.byField().get(fieldKey);
    if (vm) return vm;
    if (aiInput && this.failed()) {
      return {
        kind: 'unavailable',
        fieldKey,
        label: AI_NOT_AVAILABLE,
        reason: AI_READ_FAILED_REASON,
      };
    }
    return null;
  }

  /** The stored view of an available suggestion (the reason dialog reads its level). */
  availableView(fieldKey: string): AvailableSuggestionView | null {
    const view = this.views().find((v) => v.fieldKey === fieldKey);
    return view?.status === 'available' ? view : null;
  }

  /** `shown`, once per suggestion for this page. */
  markShown(fieldKey: string): void {
    const id = this.suggestionIdOf(fieldKey);
    if (id === null || this.shown.has(id)) return;
    this.shown.add(id);
    this.send(id, { action: 'shown' });
  }

  /**
   * "Copy to comment": posts `copied` once and returns the text for the comment box (null if none): the
   * explanation, plus the suggested numbers for use numbers (`copyTextOf`).
   */
  copied(fieldKey: string): string | null {
    const view = this.availableView(fieldKey);
    if (view === null) return null;
    this.copiedFields.add(fieldKey);
    if (!this.copiedSent.has(view.suggestionId)) {
      this.copiedSent.add(view.suggestionId);
      this.send(view.suggestionId, { action: 'copied' });
    }
    return copyTextOf(view);
  }

  /** After a comment on the field was saved: `comment_saved` only when its text came from a copy. The server decides "edited". */
  commentSaved(fieldKey: string, commentId: string | number): void {
    if (!this.copiedFields.has(fieldKey)) return;
    // One comment per copy: a later comment on the field, typed by hand, is not the AI's.
    this.copiedFields.delete(fieldKey);
    const id = this.suggestionIdOf(fieldKey);
    if (id === null) return;
    this.send(id, { action: 'comment_saved', commentId: String(commentId) });
  }

  /**
   * FR-10: records the reason before the validation. Resolves `true` once the server stored it and `false`
   * when it did not (or there is no level to compare); it never rejects. The page validates only on `true`,
   * so a failed POST never leaves a validation without its reason.
   */
  async validatedAbove(fieldKey: string, validatedLevel: number, reason: string): Promise<boolean> {
    const view = this.availableView(fieldKey);
    const key = this.key();
    // Levels only (IRL / IUL): an indicative suggestion has no level to compare.
    if (view === null || key === null || view.valueKind !== 'level') return false;
    try {
      await firstValueFrom(
        this.api.sendEvent(key.timelineId, key.resultCode, view.suggestionId, {
          action: 'validated_above_ai',
          aiLevel: view.suggestedValue,
          validatedLevel,
          reason,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private suggestionIdOf(fieldKey: string): string | null {
    return this.availableView(fieldKey)?.suggestionId ?? null;
  }

  private send(suggestionId: string, event: AiSuggestionEvent): void {
    const key = this.key();
    if (key === null) return;
    this.api
      .sendEvent(key.timelineId, key.resultCode, suggestionId, event)
      .subscribe({ error: () => undefined });
  }

  /** True when the last `load` was for this result (the page reloads the same result after a write). */
  isLoaded(timelineId: number, resultCode: number): boolean {
    return this.isKey(timelineId, resultCode);
  }

  private isKey(timelineId: number, resultCode: number): boolean {
    const key = this.key();
    return key !== null && key.timelineId === timelineId && key.resultCode === resultCode;
  }
}
