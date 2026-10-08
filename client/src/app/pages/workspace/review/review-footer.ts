import { Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan/button';

export type FooterMode = 'normal' | 'warn' | 'confirm';

/** Sticky footer: Back / Next section, attention counter, Finish assessment (+ warn / confirm steps). */
@Component({
  selector: 'qa-review-footer',
  imports: [HlmButton],
  templateUrl: './review-footer.html',
  host: {
    class:
      '@container flex min-h-[72px] flex-none flex-wrap items-center gap-y-2.5 border-t border-(--border) bg-(--surface) px-6 py-3 max-sm:px-4',
  },
})
export class ReviewFooter {
  readonly mode = input<FooterMode>('normal');
  readonly sectionNum = input(1);
  readonly sectionTotal = input(1);
  /** Fields that still need the assessor. */
  readonly openCount = input(0);
  readonly canFinish = input(true);
  /** Finish warning: "2 theory of change contributions still need your review." */
  readonly warnCount = input(0);
  readonly warnText = input('');
  /** Confirm step. */
  readonly resolvedCount = input(0);
  readonly commentedCount = input(0);
  readonly skipped = input(0);

  readonly back = output();
  readonly next = output();
  readonly finish = output();
  readonly reviewThem = output();
  readonly finishAnyway = output();
  readonly keepWorking = output();
  readonly confirmFinish = output();
}
