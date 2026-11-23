// @akili-spec escalation/round-2
import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { LeadDecisionKind } from '../../../core/api/assessment.models';
import { QaButtonImports } from '../../../ui';
import { ThreadItemVm } from './review-model';
import { ReviewStore } from './review-store';

/** The decision being written: on which comment, which kind. */
interface Editing {
  readonly commentId: number;
  readonly kind: LeadDecisionKind;
}

/**
 * Round 2 (Lead, P2-3912): the round-1 thread of a core field inside its card, and the Lead's decision on each
 * comment ("Agree with the program" / "Escalate to TPB", a comment required; "Change" and "Clear" once decided).
 * Controls follow the view model only (`choices`, which the mapper takes from the server's `decidable` / `choices`);
 * every write and its refusal live in `ReviewStore`. This component holds only the open editor and its text.
 *
 * TODO(design): Juanpa — provisional look. It reuses the card's existing tokens and the drawer's thread styles; no
 * mockup exists yet. Restyle freely in `review-lead-thread.html`; the logic does not depend on the markup.
 */
@Component({
  selector: 'qa-review-lead-thread',
  imports: [FormField, QaButtonImports],
  templateUrl: './review-lead-thread.html',
  host: { class: 'block' },
})
export class ReviewLeadThread {
  private readonly store = inject(ReviewStore);

  readonly items = input.required<readonly ThreadItemVm[]>();
  /** The field's label, for accessible names. */
  readonly fieldLabel = input('');
  /** Open by default while a comment waits for a decision. Once open it stays open (deciding never folds it away). */
  readonly open = input(false);

  protected readonly expanded = linkedSignal<boolean, boolean>({
    source: this.open,
    computation: (now, previous) => (previous?.value ?? false) || now,
  });
  protected readonly pendingCount = computed(() => this.items().filter((i) => i.pending).length);
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

  protected start(item: ThreadItemVm, kind: LeadDecisionKind): void {
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

  protected editorTitle(kind: LeadDecisionKind): string {
    return kind === 'agree_program' ? 'Why do you agree with the program?' : 'Why escalate to TPB?';
  }

  protected saveLabel(item: ThreadItemVm, kind: LeadDecisionKind): string {
    return kind === 'agree_program' && item.agreeEnds ? 'Agree and finish' : 'Save decision';
  }
}
