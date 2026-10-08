import { Component, input, output } from '@angular/core';
import { QaTooltipImports } from '../../../ui';
import { ReviewAiNote } from './review-ai-note';
import { ReviewCardActions } from './review-card-actions';
import { CardAction, TocCardVm, TocGroupVm } from './review-model';
import { ReviewStateChips } from './review-state-chips';
import { TOC_TIP } from './review.mock';

export interface TocCardAction {
  readonly id: string;
  readonly action: CardAction;
}

/** "Theory of change" section: contributions grouped by science program (or the ToC mapping card). */
@Component({
  selector: 'qa-review-toc-section',
  imports: [QaTooltipImports, ReviewAiNote, ReviewCardActions, ReviewStateChips],
  templateUrl: './review-toc-section.html',
  host: { class: 'contents' },
})
export class ReviewTocSection {
  readonly groups = input.required<readonly TocGroupVm[]>();
  /** Real contributions (0 when the result only has the ToC mapping card). */
  readonly count = input(0);
  readonly programs = input(0);
  readonly reviewed = input(0);
  readonly act = output<TocCardAction>();

  protected readonly tip = TOC_TIP;

  protected cardClass(card: TocCardVm): string {
    return card.highlighted
      ? 'border-l-[3px] border-l-(--danger) bg-(--danger-bg) pl-[13px] hover:border-l-(--danger)'
      : 'bg-(--surface)';
  }
}
