import { Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { UnsavedChanges } from '../../../core/forms/unsaved-changes';
import { QaButtonImports, QaDrawerCloseGuard, QaDrawerImports, QaMenuImports } from '../../../ui';
import { ReviewInstructionNote } from './review-instruction-note';
import { FieldComment, QUICK_COMMENTS } from './review.mock';

/**
 * What the form at the bottom does: the assessor adds a comment, the lead assessor writes the instruction for the
 * third-party broker (and marks the field as highlight), the TPB writes the note for the PPU with "Required changes",
 * and otherwise the TPB and the PPU only read.
 */
export type CommentsDrawerMode = 'comment' | 'instruction' | 'note' | 'read';

export interface CommentsDrawerVm {
  readonly label: string;
  readonly section: string;
  readonly value: string;
  readonly highlighted: boolean;
  readonly comments: readonly FieldComment[];
  readonly mode: CommentsDrawerMode;
  /** Lead assessor's instruction, shown above the thread while the field is highlighted (read modes). */
  readonly instruction: string;
  /** Third-party broker's note for the PPU, shown above the thread after "Required changes". */
  readonly ppuNote: string;
  /** The assessor's comment that can still be withdrawn (the program has not answered it), or -1. */
  readonly withdrawIndex: number;
}

/** 480px drawer with the comment thread of one field, quick comments and the comment form. */
@Component({
  selector: 'qa-review-comments-drawer',
  imports: [FormField, QaButtonImports, QaDrawerImports, QaMenuImports, ReviewInstructionNote],
  templateUrl: './review-comments-drawer.html',
  host: { class: 'contents' },
})
export class ReviewCommentsDrawer {
  readonly open = model(false);
  readonly field = input<CommentsDrawerVm | null>(null);
  /** Signal Forms field bound to the textarea (owned by the view). */
  readonly text = input.required<FieldTree<string>>();
  /** Show the empty-comment error (after an Add attempt). */
  readonly showError = input(false);
  /** Bumped by the view to move focus back to the textarea (open, quick comment, failed submit). */
  readonly focusTick = input(0);

  readonly add = output();
  readonly quickPick = output<string>();
  /** Index of the comment the assessor withdraws. */
  readonly withdraw = output<number>();

  protected readonly query = signal('');
  /** "Discard what you wrote?" step, asked before Esc / overlay / X close a drawer with a draft. */
  protected readonly confirmDiscard = signal(false);
  // Tab close / reload / leaving the view ask first while a comment draft is open.
  private readonly unregisterUnsaved = inject(UnsavedChanges).register(() => this.open() && !!this.text()().value().trim());
  private readonly unsavedCleanup = inject(DestroyRef).onDestroy(this.unregisterUnsaved);

  protected readonly closeGuard: QaDrawerCloseGuard = () => {
    if (!this.text()().value().trim()) return true;
    if (this.confirmDiscard()) {
      this.discardDraft();
      return true;
    }
    this.confirmDiscard.set(true);
    return false;
  };
  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = QUICK_COMMENTS.filter((c) => !q || c.text.toLowerCase().includes(q) || c.cat.toLowerCase().includes(q));
    return [...new Set(list.map((c) => c.cat))].map((cat) => ({ cat, items: list.filter((c) => c.cat === cat) }));
  });

  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('draftBox');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('qcSearch');

  constructor() {
    // Typing again, or another open / field, hides the discard question.
    effect(() => {
      this.text()().value();
      this.open();
      this.field();
      untracked(() => this.confirmDiscard.set(false));
    });
    effect(() => {
      if (!this.open() || !this.focusTick()) return;
      // Wait for the sheet's own initial focus, then put the caret at the end of the draft.
      setTimeout(() => {
        const el = this.textarea()?.nativeElement;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 80);
    });
  }

  protected discardAndClose(): void {
    this.discardDraft();
    this.open.set(false);
  }

  private discardDraft(): void {
    this.text()().value.set('');
    this.confirmDiscard.set(false);
  }

  protected onQuickOpened(): void {
    this.query.set('');
    setTimeout(() => this.search()?.nativeElement.focus());
  }

  /** Keep typing in the search box from triggering the menu's typeahead / item navigation. */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Tab' && event.key !== 'ArrowDown') event.stopPropagation();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.add.emit();
  }
}
