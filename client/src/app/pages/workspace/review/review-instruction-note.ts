import { Component, input } from '@angular/core';

/** The lead assessor's instruction for the third-party broker, on a highlighted card and in its comments drawer. */
@Component({
  selector: 'qa-review-instruction-note',
  host: { class: 'flex flex-col gap-1 rounded-[8px] border border-(--border) bg-(--surface) px-3 py-2.5' },
  template: `
    <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Instruction for the third-party broker</span>
    <span class="text-(length:--fs-13) leading-[1.55] text-pretty text-(--text-2)">{{ text() }}</span>
  `,
})
export class ReviewInstructionNote {
  readonly text = input.required<string>();
}
