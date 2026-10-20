import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { UnsentQueue } from '../../core/http/unsent-queue';
import { QaButtonImports } from '../button/qa-button';
import { QaDialogImports } from '../dialog/qa-dialog';
import { QaDrawerImports } from '../drawer/qa-drawer';

/**
 * Everything the user sees of the unsent queue (core/http/unsent-queue.ts):
 * - "Could not send" dialog right after a write fails to reach the server (Retry / Keep in queue;
 *   closing it keeps the changes, so nothing is lost by pressing Esc);
 * - an "Unsent" button in the top bar while anything is kept, opening the list;
 * - the list opens by itself once after sign-in when something is still waiting from before.
 */
@Component({
  selector: 'qa-unsent-center',
  imports: [DatePipe, QaButtonImports, QaDialogImports, QaDrawerImports],
  host: { class: 'contents' },
  template: `
    @if (queue.count() > 0) {
      <button
        type="button"
        class="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-(length:--fs-13) font-semibold whitespace-nowrap text-(--warning) hover:bg-(--surface-4)"
        [attr.aria-label]="buttonLabel()"
        (click)="listOpen.set(true)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <span>Unsent ({{ queue.count() }})</span>
      </button>
    }

    <qa-dialog [(open)]="decisionOpen" title="Could not send" subtitle="We could not reach the QA service. Nothing was lost." width="480px">
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
        @for (item of queue.awaitingDecision(); track item.id) {
          <li class="truncate text-(length:--fs-13) text-(--text-2)">{{ item.label }}</li>
        }
      </ul>
      <div qaDialogFooter>
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="keep()">Keep in queue</button>
        <button hlmBtn qaBtn tone="primary" type="button" [disabled]="retrying()" (click)="retry()">Retry</button>
      </div>
    </qa-dialog>

    <qa-drawer [(open)]="listOpen" title="Unsent changes" subtitle="Sent by themselves when the connection is back." width="480px">
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        @for (item of queue.items(); track item.id) {
          <li class="flex flex-col gap-1 rounded-lg border border-(--border) p-3">
            <div class="flex items-start justify-between gap-3">
              <span class="min-w-0 text-(length:--fs-14) font-medium text-(--text)">{{ item.label }}</span>
              <span class="flex-none text-(length:--fs-12) text-(--text-3)">{{ stateText(item.state) }}</span>
            </div>
            <span class="text-(length:--fs-12) text-(--text-3)">{{ item.createdAt | date: 'd MMM, HH:mm' }}</span>
            @if (item.error) {
              <p class="m-0 text-(length:--fs-13) text-(--danger)">{{ item.error }}</p>
            }
            <div class="flex justify-end gap-2">
              @if (item.state === 'rejected') {
                <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="queue.retryRejected(item.id)">Try again</button>
              }
              <button hlmBtn qaBtn tone="danger-quiet" size="sm" type="button" [disabled]="item.state === 'sending'" (click)="queue.dismiss(item.id)">Discard</button>
            </div>
          </li>
        } @empty {
          <li class="text-(length:--fs-13) text-(--text-3)">Nothing waiting.</li>
        }
      </ul>
      <div qaDrawerFooter>
        <button hlmBtn qaBtn tone="primary" type="button" [disabled]="!hasPending()" (click)="sendNow()">Send now</button>
      </div>
    </qa-drawer>
  `,
})
export class QaUnsentCenter {
  protected readonly queue = inject(UnsentQueue);

  /** Open while writes wait for a decision; closing it any other way keeps them. */
  protected readonly decisionOpen = linkedSignal(() => this.queue.awaitingDecision().length > 0);
  protected readonly listOpen = signal(false);
  protected readonly retrying = signal(false);
  protected readonly hasPending = computed(() => this.queue.items().some((item) => item.state === 'pending'));
  protected readonly buttonLabel = computed(() => `${this.queue.count()} unsent changes, open the list`);

  private shownOnStart = false;

  constructor() {
    effect(() => {
      // Esc / overlay / X closed the dialog: keep the changes rather than drop them.
      if (!this.decisionOpen() && untracked(() => this.queue.awaitingDecision().length > 0)) {
        this.shownOnStart = true;
        untracked(() => this.queue.keepAwaiting());
      }
    });
    effect(() => {
      if (this.shownOnStart || this.queue.count() === 0) return;
      this.shownOnStart = true;
      untracked(() => this.listOpen.set(true));
    });
  }

  protected keep(): void {
    // The user just chose this: no need to open the list on top of it.
    this.shownOnStart = true;
    this.queue.keepAwaiting();
  }

  protected async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.queue.retryAwaiting();
    } finally {
      this.retrying.set(false);
    }
  }

  protected sendNow(): void {
    void this.queue.sendPending();
  }

  protected stateText(state: string): string {
    return state === 'sending' ? 'Sending…' : state === 'rejected' ? 'Not accepted' : 'Waiting';
  }
}
