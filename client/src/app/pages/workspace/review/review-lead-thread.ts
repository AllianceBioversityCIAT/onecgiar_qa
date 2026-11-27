// @akili-spec escalation/round-2
import { Component, ElementRef, computed, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { DecisionKind } from '../../../core/api/assessment.models';
import { QaButtonImports, QaMenuImports } from '../../../ui';
import { ReviewDeleteComment } from './review-delete-comment';
import { ThreadItemVm } from './review-model';
import { ReviewStore } from './review-store';

/** The editor's question, by decision (Lead step 3, TPB step 4, PPU step 5). */
const EDITOR_TITLES: Readonly<Record<DecisionKind, string>> = {
  agree_program: 'Why do you agree with the program?',
  escalate: 'Why escalate to TPB?',
  tpb_agree_program: 'Why side with the program?',
  tpb_agree_assessor: 'Why side with the assessor?',
  ppu_done: 'Note (optional)',
};

/** The decision being written: on which comment, which kind. */
interface Editing {
  readonly commentId: number;
  readonly kind: DecisionKind;
}

/**
 * Round 2 (Lead, P2-3912): the round-1 thread of a core field inside its card, and the Lead's decision on each
 * comment ("Agree with the program" / "Escalate to TPB", a comment required; "Change" and "Clear" once decided).
 * The TPB (P2-3916) reads the escalated comments with the Lead's reason and sides with the program or the assessor
 * (reason required); the PPU (P2-3917) reads the cases with the TPB's decision and marks each Done (note optional,
 * "Undo" while the result is open). Same block, the words follow `item.mode`.
 * Controls follow the view model only (`choices`, which the mapper takes from the server's `decidable` / `choices`);
 * every write and its refusal live in `ReviewStore`. This component holds only the open editor and its text.
 *
 * The TPB's editor also offers the TPB role's quick comments and saves new ones to that list (P2-3916). The Lead's and
 * the PPU's stories do not ask for them, so their editors do not show them.
 *
 * TODO(design): Juanpa — provisional look. It reuses the card's existing tokens and the drawer's thread styles; no
 * mockup exists yet. Restyle freely in `review-lead-thread.html`; the logic does not depend on the markup.
 */
@Component({
  selector: 'qa-review-lead-thread',
  imports: [FormField, QaButtonImports, QaMenuImports, ReviewDeleteComment],
  templateUrl: './review-lead-thread.html',
  host: { class: 'block' },
})
export class ReviewLeadThread {
  private readonly store = inject(ReviewStore);

  readonly items = input.required<readonly ThreadItemVm[]>();
  /** The field's label, for accessible names. */
  readonly fieldLabel = input('');
  /** The block's heading: the round-1 thread, or the Lead's own round-2 comments (tramo 4). */
  readonly title = input('Round 1 comments');
  /** `data-testid` of the block (`lead-thread` / `lead-own`). */
  readonly testId = input('lead-thread');
  /** Open by default while a comment waits for a decision. Once open it stays open (deciding never folds it away). */
  readonly open = input(false);

  protected readonly expanded = linkedSignal<boolean, boolean>({
    source: this.open,
    computation: (now, previous) => (previous?.value ?? false) || now,
  });
  protected readonly pendingCount = computed(() => this.items().filter((i) => i.pending).length);
  /** The PPU's cases are "open"; the Lead's and the TPB's comments are "to decide". */
  protected readonly pendingWord = computed(() => (this.items()[0]?.mode === 'ppu' ? 'open' : 'to decide'));
  protected readonly errors = this.store.decisionErrors;

  /** "Change" pressed on a decided comment: its choices show again. */
  protected readonly changing = signal<number | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly draft = signal({ text: '' });
  protected readonly draftForm = form(this.draft);
  protected readonly length = computed(() => [...this.draft().text.trim()].length);

  protected busy(commentId: number, action: 'decide' | 'clear'): boolean {
    const d = this.store.deciding();
    return d?.commentId === commentId && d.action === action;
  }

  /** Any decision of the page is on its way: the other controls wait (the store refuses a second write anyway). */
  protected readonly anyBusy = computed(() => this.store.deciding() !== null);

  // ---------- Quick comments of the TPB (P2-3916) ----------

  /** Only the TPB's story asks for quick comments in the decision editor. */
  protected offersQuick(item: ThreadItemVm): boolean {
    return item.mode === 'tpb';
  }

  protected readonly savingQuick = this.store.savingQuick;
  protected readonly query = signal('');
  protected readonly matches = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.store.quickComments().filter((c) => !q || c.body.toLowerCase().includes(q));
  });
  protected readonly hasQuickList = computed(() => this.store.quickComments().length > 0);
  /** The last text this block saved as a quick comment; the link says "Saved" until the text changes. */
  private readonly quickSavedText = signal<string | null>(null);
  protected readonly quickSaved = computed(() => {
    const text = this.draft().text.trim();
    return !!text && (this.quickSavedText() === text || this.store.quickComments().some((q) => q.body === text));
  });
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('qcSearch');

  protected pickQuick(text: string): void {
    this.draft.update(({ text: cur }) => ({ text: cur.trim() ? cur.replace(/\s+$/, '') + '\n' + text : text }));
  }

  protected async saveQuick(): Promise<void> {
    const text = this.draft().text.trim();
    if (await this.store.saveQuickComment(text)) this.quickSavedText.set(text);
  }

  protected onQuickOpened(): void {
    this.query.set('');
    setTimeout(() => this.search()?.nativeElement.focus());
  }

  /** Keep typing in the search box from triggering the menu's typeahead / item navigation. */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' && event.key !== 'Tab' && event.key !== 'ArrowDown') event.stopPropagation();
  }

  protected start(item: ThreadItemVm, kind: DecisionKind): void {
    if (this.offersQuick(item)) void this.store.loadQuickComments();
    this.editing.set({ commentId: item.commentId, kind });
    // Changing to the same kind keeps the text the Lead wrote; another kind starts empty.
    this.draft.set({ text: item.decision?.kind === kind ? item.decision.text : '' });
  }

  protected change(item: ThreadItemVm): void {
    this.editing.set(null);
    this.changing.set(item.commentId);
  }

  protected cancel(): void {
    this.editing.set(null);
    this.changing.set(null);
    this.draft.set({ text: '' });
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing) return;
    const outcome = await this.store.decide(editing.commentId, editing.kind, this.draft().text);
    if (outcome.ok && this.editing() === editing) this.cancel();
  }

  protected clear(item: ThreadItemVm): void {
    this.cancel();
    void this.store.clearDecision(item.commentId);
  }

  protected isEditing(item: ThreadItemVm): boolean {
    return this.editing()?.commentId === item.commentId;
  }

  /** The choice buttons show on a comment with no decision, or after "Change". */
  protected showChoices(item: ThreadItemVm): boolean {
    return item.choices.length > 0 && !this.isEditing(item) && (!item.decision || this.changing() === item.commentId);
  }

  protected editorTitle(kind: DecisionKind): string {
    return EDITOR_TITLES[kind];
  }

  protected saveLabel(item: ThreadItemVm, kind: DecisionKind): string {
    if (kind === 'ppu_done') return 'Mark as done';
    return kind === 'agree_program' && item.agreeEnds ? 'Agree and finish' : 'Save decision';
  }

  /** The decided state reads red when it keeps the field grey (escalated, or the TPB sided with the assessor). */
  protected againstProgram(kind: DecisionKind): boolean {
    return kind === 'escalate' || kind === 'tpb_agree_assessor';
  }
}
