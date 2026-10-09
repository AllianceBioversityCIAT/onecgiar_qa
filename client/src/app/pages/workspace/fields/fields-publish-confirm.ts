import { Component, input, linkedSignal, model, output } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDialogImports } from '../../../ui';
import { FieldChangeGroupVm } from './fields-config';

/** "Review & publish" pop-up: unpublished changes of every result type, grouped; undo one, discard all (asks first) or publish all. */
@Component({
  selector: 'qa-fields-publish-confirm',
  imports: [HlmButton, QaDialogImports],
  host: { class: 'contents' },
  template: `
    <qa-dialog [(open)]="open" [title]="title()" subtitle="Applies to results loaded from now on. Results already under assessment are not affected." width="600px">
      @for (group of groups(); track group.type) {
        <section [attr.aria-labelledby]="'fields-publish-' + $index" class="flex flex-col">
          <h3 [id]="'fields-publish-' + $index" class="m-0 flex items-center gap-2 pt-2 pb-1 text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">
            {{ group.type }}
            <span class="rounded-full bg-(--surface-3) px-1.5 py-px font-(family-name:--qa-mono) text-(length:--fs-11) tabular-nums">{{ group.changes.length }}</span>
          </h3>
          <ul class="m-0 flex list-none flex-col p-0">
            @for (change of group.changes; track change.id) {
              <li class="flex min-h-11 items-center gap-3 border-b border-(--surface-4) py-2 text-(length:--fs-13) leading-[1.5] font-normal text-(--text-2) last:border-b-0">
                <span class="min-w-0 flex-1"><span class="font-semibold">{{ change.name }}</span><span class="text-(--text-3)"> — {{ change.description }}</span></span>
                <button
                  type="button"
                  (click)="undo.emit({ type: group.type, id: change.id })"
                  [attr.aria-label]="'Undo the change to ' + change.name + ' in ' + group.type"
                  class="min-h-8 flex-none cursor-pointer rounded-md border-none bg-transparent px-2 text-(length:--fs-13) font-medium text-(--accent) hover:bg-(--tint) focus-visible:shadow-(--focus-ring) focus-visible:outline-none max-md:min-h-10"
                >
                  Undo
                </button>
              </li>
            }
          </ul>
        </section>
      }

      @if (confirmDiscard()) {
        <div role="alert" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-(--danger-bg) px-3 py-2">
          <span class="mr-auto text-(length:--fs-13) text-(--text-2)">Discard all {{ count() }} {{ count() === 1 ? 'change' : 'changes' }}? This can't be undone.</span>
          <button type="button" (click)="confirmDiscard.set(false)" class="min-h-8 cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-(length:--fs-13) font-medium text-(--accent) outline-none hover:bg-(--tint) focus-visible:shadow-(--focus-ring) max-md:min-h-10">Keep them</button>
          <button type="button" (click)="discard.emit()" class="min-h-8 cursor-pointer rounded-md border-0 bg-transparent px-2.5 text-(length:--fs-13) font-semibold text-(--danger) outline-none hover:bg-(--danger-bg) focus-visible:shadow-(--focus-ring) max-md:min-h-10">Discard all</button>
        </div>
      }

      <div qaDialogFooter class="contents">
        @if (!confirmDiscard()) {
          <button
            type="button"
            (click)="confirmDiscard.set(true)"
            class="mr-auto min-h-9 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-(length:--fs-13) font-medium text-(--danger) outline-none hover:bg-(--danger-bg) focus-visible:shadow-(--focus-ring) max-md:min-h-10"
          >
            Discard all
          </button>
        }
        <button
          hlmBtn
          type="button"
          variant="outline"
          (click)="open.set(false)"
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
    </qa-dialog>
  `,
})
export class FieldsPublishConfirm {
  readonly open = model(false);
  readonly groups = input.required<readonly FieldChangeGroupVm[]>();
  /** Changes across all groups. */
  readonly count = input.required<number>();

  readonly publish = output<void>();
  /** Undo one change. */
  readonly undo = output<{ type: string; id: string }>();
  /** Discard every change, after the inline confirmation. */
  readonly discard = output<void>();

  /** Inline "Discard all?" question; reset every time the pop-up opens or closes. */
  protected readonly confirmDiscard = linkedSignal(() => (this.open(), false));

  protected title(): string {
    const n = this.count();
    return `Publish ${n} ${n === 1 ? 'change' : 'changes'}`;
  }
}
