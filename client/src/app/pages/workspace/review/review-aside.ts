import { Component, computed, input, model, output } from '@angular/core';
import { ReviewCodeInfo } from './review-code-info';
import { ResultHeaderVm, SectionNavVm } from './review-model';
import { CYCLE } from './review.mock';

/** Left column: result code card, section navigation, progress, AI flags, guidance. Collapses to a rail. */
@Component({
  selector: 'qa-review-aside',
  imports: [ReviewCodeInfo],
  templateUrl: './review-aside.html',
  host: {
    class:
      'relative box-border flex flex-none flex-col overflow-x-hidden bg-(--surface) transition-[width] duration-150 ease-[cubic-bezier(.32,.72,0,1)]',
    '[class]': 'layoutClass()',
    role: 'complementary',
    'aria-label': 'Result sections',
  },
})
export class ReviewAside {
  readonly result = input.required<ResultHeaderVm>();
  readonly sections = input.required<readonly SectionNavVm[]>();
  readonly resolved = input(0);
  readonly total = input(0);
  readonly aiCount = input(0);
  /** Container narrower than 900px: the column stacks on top and cannot collapse. */
  readonly narrow = input(false);
  /** Collapsed to the 56px rail. */
  readonly rail = model(false);

  readonly go = output<number>();
  readonly aiGo = output();

  protected readonly cycle = CYCLE;
  protected readonly railOn = computed(() => this.rail() && !this.narrow());

  protected readonly layoutClass = computed(() => {
    if (this.narrow()) return 'w-auto items-stretch gap-0.5 border-b border-(--border) px-5 py-4 max-sm:px-4 overflow-y-visible';
    if (this.railOn()) return 'w-14 items-center gap-1 overflow-y-auto border-r border-(--border) px-0 py-4';
    return 'w-[240px] items-stretch gap-0.5 overflow-y-auto border-r border-(--border) px-5 py-6';
  });

  protected sectionTitle(s: SectionNavVm): string {
    return s.name + (s.open ? ' · ' + s.open + ' pending' : ' · complete');
  }
}
