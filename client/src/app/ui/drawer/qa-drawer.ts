import { Component, Directive, computed, contentChild, input, model, viewChild } from '@angular/core';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnSheet, BrnSheetImports } from '@spartan-ng/brain/sheet';
import { injectQaTokens } from '../tokens/qa-tokens';

export type QaDrawerWidth = '480px' | '720px';

/** Returns true to let the drawer close, false to keep it open (e.g. to ask "Discard what you wrote?"). */
export type QaDrawerCloseGuard = () => boolean | Promise<boolean>;

/** Marks the element projected into the drawer footer (right-aligned action row). */
@Directive({ selector: '[qaDrawerFooter]' })
export class QaDrawerFooter {}

/**
 * Element shown in the header row, next to the title: before it by default (avatar), or after it
 * with qaDrawerHeader="end" (tags such as "Highlighted").
 */
@Directive({
  selector: '[qaDrawerHeader]',
  host: { '[class]': "position() === 'end' ? 'order-last flex-none' : 'flex-none'" },
})
export class QaDrawerHeader {
  readonly position = input<'start' | 'end' | ''>('start', { alias: 'qaDrawerHeader' });
}

/**
 * Side sheet from the right, as in the "QA Platform" mockup (Invite assessor, person drawers).
 * Built on BrnSheet: overlay, Esc / overlay click to close, focus trap and focus return.
 * `closeGuard` runs before Esc / overlay click / X close it; returning false keeps it open without
 * any close-and-reopen flicker. Setting `open` to false from code always closes (no guard).
 *
 * <qa-drawer [(open)]="inviteOpen" title="Invite assessor" subtitle="They get an email…" width="720px" [closeGuard]="askDiscard">
 *   <span qaDrawerHeader>…avatar…</span>
 *   …body…
 *   <div qaDrawerFooter>…buttons…</div>
 * </qa-drawer>
 */
@Component({
  selector: 'qa-drawer',
  imports: [BrnSheetImports],
  host: { class: 'contents', '[attr.title]': 'null' },
  template: `
    <brn-sheet
      #sheet="brnSheet"
      side="right"
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="onStateChanged($event)"
    >
      <brn-sheet-overlay
        class="qa-tokens bg-(--overlay) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <ng-template brnSheetContent>
        <div
          [attr.data-state]="sheet.stateComputed()"
          class="qa-tokens fixed inset-y-0 right-0 flex h-dvh max-w-[100vw] flex-col border-l border-(--border-raised) bg-(--surface-raised) shadow-(--shadow-pop) duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
          [class]="widthClass()"
        >
          <div class="flex flex-none items-start gap-3 border-b border-(--surface-4) px-6 py-5">
            <div class="flex min-w-0 flex-1 items-start gap-3">
              <ng-content select="[qaDrawerHeader]" />
              <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
                <h2 brnSheetTitle class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ title() }}</h2>
                @if (subtitle()) {
                  <p brnSheetDescription class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">{{ subtitle() }}</p>
                }
              </div>
            </div>
            <button
              brnSheetClose
              type="button"
              [attr.aria-label]="closeLabel()"
              class="flex size-7 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-(--text-3) hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
            <ng-content />
          </div>
          @if (footer()) {
            <div class="flex flex-none flex-wrap items-center justify-end gap-2.5 border-t border-(--surface-4) px-6 py-4">
              <ng-content select="[qaDrawerFooter]" />
            </div>
          }
        </div>
      </ng-template>
    </brn-sheet>
  `,
})
export class QaDrawer {
  /** Two-way open state: `[(open)]="signal"`. Set to false by Esc, overlay click and the X button. */
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly width = input<QaDrawerWidth>('480px');
  readonly closeLabel = input('Close');
  /** Asked before Esc / overlay click / X close the drawer. */
  readonly closeGuard = input<QaDrawerCloseGuard | null>(null);

  protected readonly footer = contentChild(QaDrawerFooter);
  protected readonly widthClass = computed(() => (this.width() === '720px' ? 'w-[720px]' : 'w-[480px]'));
  private readonly sheet = viewChild.required(BrnSheet);

  constructor() {
    injectQaTokens();
  }

  protected onStateChanged(state: BrnDialogState): void {
    // Closed from code (open already false), or opened: nothing to do.
    if (state !== 'closed' || !this.open()) return;
    const guard = this.closeGuard();
    const verdict = guard ? guard() : true;
    if (verdict === true) {
      this.open.set(false);
      return;
    }
    // The sheet just started closing (Esc / overlay / X): cancel it in the same task, before any
    // frame is painted, so the drawer never visibly closes and reopens.
    this.sheet().open();
    if (verdict !== false) void verdict.then((ok) => ok && this.open.set(false));
  }
}

export const QaDrawerImports = [QaDrawer, QaDrawerFooter, QaDrawerHeader] as const;
