// @akili-spec escalation/round-2
import { Component, computed, inject, input, signal } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import { ReviewStore } from './review-store';

/**
 * Round 2 (Lead, P2-3912 tramo 4): "Delete" on another reviewer's comment, with an inline confirmation before the
 * write (round-2 contract § 4.4). The write, its lock and its refusal by code live in `ReviewStore`; this component
 * only holds whether the confirmation is open. Shown only where the view model says `canDelete`.
 *
 * TODO(design): Juanpa — provisional look (link button, inline confirmation in the comment's frame). No mockup yet.
 */
@Component({
  selector: 'qa-review-delete-comment',
  imports: [QaButtonImports],
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    @if (confirming()) {
      <div role="alertdialog" [attr.aria-labelledby]="'delete-comment-ask-' + commentId()" class="flex flex-col gap-1.5 rounded-[6px] border border-(--border) bg-(--surface-3) px-2.5 py-2">
        <span [id]="'delete-comment-ask-' + commentId()" class="text-(length:--fs-13) leading-[1.5] text-pretty text-(--text-2)">Delete this comment by {{ who() }}? It leaves this result for everyone, with any decision on it. This cannot be undone.</span>
        <div class="flex flex-wrap items-center gap-2">
          <button hlmBtn qaBtn tone="danger" size="sm" type="button" [loading]="busy()" [disabled]="otherBusy()" (click)="confirm()">Delete comment</button>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [disabled]="busy()" (click)="confirming.set(false)">Cancel</button>
        </div>
      </div>
    } @else {
      <div class="flex">
        <button hlmBtn qaBtn tone="link" size="sm" flush="start" type="button" [attr.aria-label]="'Delete the comment by ' + who()" [disabled]="store.deleting() !== null" (click)="confirming.set(true)">Delete</button>
      </div>
    }
    @if (error(); as message) {
      <p role="alert" class="m-0 text-(length:--fs-12) leading-[1.45] text-(--danger)">{{ message }}</p>
    }
  `,
})
export class ReviewDeleteComment {
  protected readonly store = inject(ReviewStore);

  readonly commentId = input.required<number>();
  /** The author as the thread names them, for the confirmation and the accessible name. */
  readonly who = input.required<string>();

  protected readonly confirming = signal(false);
  protected readonly busy = computed(() => this.store.deleting() === this.commentId());
  /** Another write of the page is on its way: the store would refuse this one, so the button waits. */
  protected readonly otherBusy = computed(
    () => (this.store.deleting() !== null && !this.busy()) || this.store.deciding() !== null || this.store.finishing() || this.store.validating().size > 0,
  );
  protected readonly error = computed(() => this.store.deleteErrors().get(this.commentId()) ?? '');

  protected async confirm(): Promise<void> {
    const outcome = await this.store.deleteComment(this.commentId());
    // A refusal keeps the question closed and says why under it; a success leaves with the comment.
    if (outcome.ok || outcome.message) this.confirming.set(false);
  }
}
