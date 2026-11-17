// @akili-spec assessment/ai-suggestions
import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import type { AssessmentField, AssessmentView } from '../../../../core/api/assessment.models';
import { ReviewStore } from '../review-store';
import type { AiChipVm, AiReported } from './ai-chip.vm';
import { reportedUseRows } from './ai-chip.vm';
import { AiSuggestionsStore } from './ai-suggestions-store';

const RESULT_TYPE = 'general.result_type';
const USE_ACTORS = 'innovation_use.current_use.actors';
const USE_ORGANIZATIONS = 'innovation_use.current_use.organizations';
const USE_MEASURES = 'innovation_use.current_use.measures';

/**
 * P2-3918 plan A: the AI side of the Review page, kept out of the Review files. The page provides
 * `REVIEW_AI_PROVIDERS`, reads `chip(key)` for each field card and forwards the chip's `shown` and
 * "Copy to comment". It loads the suggestions of the result the Review page loaded (same timeline and
 * code), gives indicative chips what was reported (the category label, the use-number rows), and never
 * validates or comments on its own (AC6): "Copy to comment" only returns the text for the comment box.
 */
@Injectable()
export class ReviewAiHook {
  private readonly review = inject(ReviewStore);
  private readonly ai = inject(AiSuggestionsStore);

  /** TPB and ADMIN read the suggestion; only a writable page offers "Copy to comment". */
  readonly readOnly = computed(() => !(this.review.view()?.writable ?? false));

  private readonly fields = computed<ReadonlyMap<string, AssessmentField>>(() => {
    const view = this.review.view();
    const map = new Map<string, AssessmentField>();
    for (const section of view?.sections ?? []) for (const f of section.fields) map.set(f.key, f);
    return map;
  });

  private readonly chips = computed<ReadonlyMap<string, AiChipVm>>(() => {
    const map = new Map<string, AiChipVm>();
    for (const key of this.ai.byField().keys()) {
      const chip = this.ai.chipFor(key, true, this.reportedFor(key));
      if (chip) map.set(key, chip);
    }
    return map;
  });

  constructor() {
    // One load per result the Review page shows; a new result replaces the chips.
    effect(() => {
      const view = this.review.view();
      const timelineId = this.review.timelineId();
      if (view === null || timelineId === null) return;
      const resultCode = view.header.resultCode;
      untracked(() => void this.ai.load(timelineId, resultCode));
    });
  }

  /** The chip of a field card (`FieldVm.id` is the field key), or null when the AI does not cover it. */
  chip(fieldKey: string): AiChipVm | null {
    return this.chips().get(fieldKey) ?? null;
  }

  shown(fieldKey: string): void {
    this.ai.markShown(fieldKey);
  }

  /** "Copy to comment": records `copied` and returns the text for the comment box (null if none). */
  copy(fieldKey: string): string | null {
    return this.ai.copied(fieldKey);
  }

  /** After a comment on the field was saved (wired with the comment save of T-20). */
  commentSaved(fieldKey: string, commentId: number): void {
    this.ai.commentSaved(fieldKey, commentId);
  }

  private reportedFor(fieldKey: string): AiReported {
    if (fieldKey === RESULT_TYPE)
      return reportedCategory(this.fields().get(RESULT_TYPE), this.review.view());
    if (fieldKey === USE_ACTORS) {
      const fields = this.fields();
      const pick = (key: string) => fields.get(key);
      return reportedUseRows(
        {
          actors: pick(USE_ACTORS)?.value,
          organizations: pick(USE_ORGANIZATIONS)?.value,
          measures: pick(USE_MEASURES)?.value,
        },
        flatLabels(pick(USE_ACTORS), pick(USE_ORGANIZATIONS), pick(USE_MEASURES)),
      );
    }
    return null;
  }
}

/** The page provides both: the suggestions store and this hook, per Review page. */
export const REVIEW_AI_PROVIDERS = [AiSuggestionsStore, ReviewAiHook];

/** The reported result type as a name: its label from Reporting, else the header's result type, else the raw value. */
export function reportedCategory(
  field: AssessmentField | undefined,
  view: AssessmentView | null,
): string | null {
  if (field === undefined || field.value === null || field.value === undefined) return null;
  const id = String(field.value);
  for (const list of Object.values(field.labels ?? {})) {
    const name = list[id];
    if (typeof name === 'string' && name.trim() !== '') return name;
  }
  if (view && view.header.resultType.key === id) return view.header.resultType.label;
  return typeof field.value === 'string' || typeof field.value === 'number' ? id : null;
}

/** All control-list labels of the given fields as one id → name map (what `reportedUseRows` reads). */
export function flatLabels(...fields: (AssessmentField | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    for (const list of Object.values(f?.labels ?? {})) {
      for (const [id, name] of Object.entries(list)) if (typeof name === 'string') out[id] = name;
    }
  }
  return out;
}
