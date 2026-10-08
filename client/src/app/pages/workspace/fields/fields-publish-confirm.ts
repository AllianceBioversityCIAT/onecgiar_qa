import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { FieldChangeVm } from './fields-config';

/** Inline confirmation listing the unpublished changes. Scrolls into view and takes focus when it opens. */
@Component({
  selector: 'qa-fields-publish-confirm',
  imports: [HlmButton],
  host: {
    role: 'region',
    'aria-labelledby': 'fields-publish-title',
    tabindex: '-1',
    class:
      'flex scroll-mt-6 flex-col gap-3 rounded-xl border border-(--border-accent) bg-(--surface) px-5 py-4 outline-none focus-visible:shadow-(--focus-ring)',
    '(keydown.escape)': 'cancel.emit()',
  },
  template: `
    <h3 id="fields-publish-title" class="m-0 text-(length:--fs-14) font-semibold text-(--text)">
      Publish <span class="font-(family-name:--qa-mono) font-bold tabular-nums">{{ changes().length }}</span>
      {{ changes().length === 1 ? 'change' : 'changes' }}
    </h3>
    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      @for (change of changes(); track change.id) {
        <li class="text-(length:--fs-13) leading-[1.5] font-normal text-(--text-2)"><span class="font-semibold">{{ change.name }}</span><span class="text-(--text-3)"> — {{ change.description }}</span></li>
      }
    </ul>
    <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Applies to {{ resultType() }} results loaded from now on. Results already under assessment are not affected.</p>
    <div class="flex justify-end gap-2.5">
      <button
        hlmBtn
        type="button"
        variant="outline"
        (click)="cancel.emit()"
        class="h-auto min-h-9 rounded-lg border border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
      >
        Cancel
      </button>
      <button
        hlmBtn
        type="button"
        (click)="publish.emit()"
        class="h-auto min-h-9 rounded-lg border-0 bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
      >
        Publish
      </button>
    </div>
  `,
})
export class FieldsPublishConfirm {
  readonly changes = input.required<readonly FieldChangeVm[]>();
  readonly resultType = input.required<string>();

  readonly cancel = output<void>();
  readonly publish = output<void>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      host.nativeElement.focus({ preventScroll: true });
      host.nativeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}
