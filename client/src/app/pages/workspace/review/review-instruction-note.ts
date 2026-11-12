import { Component, input } from '@angular/core';

/**
 * A note one role leaves for the next, on the card and in its comments drawer: the lead assessor's instruction for the
 * third-party broker, or the third-party broker's note for the PPU with "Required changes".
 */
@Component({
  selector: 'qa-review-instruction-note',
  host: { class: 'flex flex-col gap-1 rounded-[8px] border border-(--border) bg-(--surface) px-3 py-2.5' },
  template: `
    <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">{{ label() }}</span>
    <span class="text-(length:--fs-13) leading-[1.55] text-pretty text-(--text-2)">{{ text() }}</span>
  `,
})
export class ReviewInstructionNote {
  readonly text = input.required<string>();
  readonly label = input('Instruction for the third-party broker');
}
