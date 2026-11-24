import { Component, computed, input, output } from '@angular/core';
import { QaTooltipImports } from '../../../ui';
import { ReviewAiNote } from './review-ai-note';
import { ReviewCardActions } from './review-card-actions';
import { CardAction, FieldVm } from './review-model';
import { ReviewStateChips } from './review-state-chips';

/** One reviewable field: label, state, value (plain, Before/Now or 0–2 scale), AI note, actions. */
@Component({
  selector: 'qa-review-field-card',
  imports: [QaTooltipImports, ReviewAiNote, ReviewCardActions, ReviewStateChips],
  templateUrl: './review-field-card.html',
  host: {
    class:
      'box-border flex flex-col items-stretch gap-2.5 rounded-[10px] border border-(--border) px-4 py-[14px] transition-colors hover:border-(--border-strong)',
    '[class]': 'toneClass()',
  },
})
export class ReviewFieldCard {
  readonly field = input.required<FieldVm>();
  readonly act = output<CardAction>();

  protected readonly toneClass = computed(() => {
    const f = this.field();
    if (f.highlighted) return 'border-l-[3px] border-l-(--danger) bg-(--danger-bg) pl-[13px] hover:border-l-(--danger)';
    return f.isHidden ? 'bg-(--surface-3)' : 'bg-(--surface)';
  });
}
