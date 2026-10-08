import { Component, computed, inject } from '@angular/core';
import { BrnProgress } from '@spartan-ng/brain/progress';

/**
 * Thin progress bar from the Cycle cards (5px, surface-4 track, primary fill).
 * Built on BrnProgress (role="progressbar", aria-valuenow/max). Give it an aria-label.
 *
 * <qa-progress [value]="62" [max]="100" aria-label="Step 5 reviewed" />
 */
@Component({
  selector: 'qa-progress',
  hostDirectives: [{ directive: BrnProgress, inputs: ['value', 'max', 'getValueLabel'] }],
  host: { class: 'block h-[5px] w-full overflow-hidden rounded-full bg-(--surface-4)' },
  template: `<div class="h-full rounded-full bg-(--primary) transition-[width] duration-300" [style.width.%]="percent()"></div>`,
})
export class QaProgress {
  private readonly progress = inject(BrnProgress);

  protected readonly percent = computed(() => {
    const max = this.progress.max() || 100;
    const value = this.progress.value() ?? 0;
    return Math.min(100, Math.max(0, (value / max) * 100));
  });
}
