import { Component, Directive, computed, contentChild, input, model } from '@angular/core';
import { BrnDialogImports, BrnDialogState } from '@spartan-ng/brain/dialog';

/** Marks the footer actions of a qa-dialog (right-aligned row under the body). */
@Directive({ selector: '[qaDialogFooter]' })
export class QaDialogFooter {}

/**
 * Centered modal dialog: title, optional subtitle, scrollable body and a footer.
 * Built on BrnDialog: overlay, Esc / overlay click to close, focus trap and focus return.
 */
@Component({
  selector: 'qa-dialog',
  imports: [BrnDialogImports],
  host: { class: 'contents', '[attr.title]': 'null' },
  template: `
    <brn-dialog #dialog="brnDialog" [state]="open() ? 'open' : 'closed'" (stateChanged)="onStateChanged($event)">
      <brn-dialog-overlay
        class="qa-tokens bg-(--overlay) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <ng-template brnDialogContent>
        <div
          [attr.data-state]="dialog.stateComputed()"
          [style.width]="'min(' + width() + ', calc(100vw - 32px))'"
          class="qa-tokens flex max-h-[min(720px,calc(100dvh-32px))] flex-col rounded-xl border border-(--border-raised) bg-(--surface-raised) shadow-(--shadow-pop) duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <div class="flex flex-none items-start gap-3 px-6 pt-5 pb-3">
            <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
              <h2 brnDialogTitle class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ title() }}</h2>
              @if (subtitle()) {
                <p brnDialogDescription class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">{{ subtitle() }}</p>
              }
            </div>
            <button
              brnDialogClose
              type="button"
              [attr.aria-label]="closeLabel()"
              class="-mr-1 flex size-7 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-(--text-3) hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5">
            <ng-content />
          </div>
          @if (hasFooter()) {
            <div class="flex flex-none flex-wrap items-center justify-end gap-2.5 border-t border-(--surface-4) px-6 py-4">
              <ng-content select="[qaDialogFooter]" />
            </div>
          }
        </div>
      </ng-template>
    </brn-dialog>
  `,
})
export class QaDialog {
  /** Two-way open state: `[(open)]="signal"`. Set to false by Esc, overlay click and the X button. */
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly subtitle = input('');
  /** CSS width, capped to the viewport. */
  readonly width = input('560px');
  readonly closeLabel = input('Close');

  private readonly footer = contentChild(QaDialogFooter);
  protected readonly hasFooter = computed(() => !!this.footer());

  protected onStateChanged(state: BrnDialogState): void {
    if (state === 'closed' && this.open()) this.open.set(false);
  }
}

export const QaDialogImports = [QaDialog, QaDialogFooter] as const;
