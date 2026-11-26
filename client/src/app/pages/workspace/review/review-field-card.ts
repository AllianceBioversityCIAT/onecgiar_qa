import { Component, computed, input, output } from '@angular/core';
import { QaTooltipImports } from '../../../ui';
import { AiChip } from './ai/ai-chip';
import type { AiChipVm } from './ai/ai-chip.vm';
import { ReviewAiNote } from './review-ai-note';
import { ReviewCardActions } from './review-card-actions';
import { ReviewInstructionNote } from './review-instruction-note';
import { CardAction, FieldVm } from './review-model';
import { ReviewStateChips } from './review-state-chips';

/** One reviewable field: label, state, value (plain, Before/Now or 0–2 scale), AI note, actions. */
@Component({
  selector: 'qa-review-field-card',
  imports: [QaTooltipImports, AiChip, ReviewAiNote, ReviewCardActions, ReviewInstructionNote, ReviewStateChips],
  templateUrl: './review-field-card.html',
  host: {
    class:
      // A row of the section card, not a card of its own: a line between fields, edge to edge (direction A, Juanpa 2026-11-25).
      'group/field box-border -mx-6 flex flex-col items-stretch gap-2.5 border-t border-(--border-soft) px-6 py-5 first-of-type:border-t-0 first-of-type:pt-1 max-sm:-mx-4 max-sm:px-4',
    '[class]': 'toneClass()',
    '[attr.data-view]': 'field().isView',
  },
})
export class ReviewFieldCard {
  readonly field = input.required<FieldVm>();
  /** The green/grey write of this field is on its way. */
  readonly busy = input(false);
  readonly act = output<CardAction>();
  /** P2-3918: the AI suggestion of this field (null = none), read only for TPB / ADMIN. */
  readonly aiChip = input<AiChipVm | null>(null);
  readonly aiReadOnly = input(false);
  readonly aiShown = output();
  readonly aiCopy = output();

  protected readonly toneClass = computed(() => {
    const f = this.field();
    if (f.highlighted) return 'border-l-[3px] border-l-(--danger) bg-(--danger-bg) pl-[21px] max-sm:pl-[13px]';
    return f.isHidden ? 'bg-(--surface-3)' : 'bg-(--surface)';
  });
}
