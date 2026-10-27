import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  BrnPopover,
  BrnPopoverImports,
  provideBrnPopoverConfig,
  provideBrnPopoverDefaultOptions,
} from '@spartan-ng/brain/popover';
import { AccessControl } from '../../../core/access/access-control';
import { Permission } from '../../../core/access/role-definitions';
import { QaButtonImports, QaSegmented, QaSegmentedOption } from '../../../ui';
import { NotificationList } from './notification-list';
import { NotificationsStore } from './notifications-store';
import type { Notification } from './notifications.model';

/** The panel lists at most this many notifications; the page has the rest. */
const PANEL_LIMIT = 8;

/**
 * The notifications bell of the top bar, for users with `ADMIN_ACCESS` only (design DD-4, DD-5, DD-10).
 * - Its host is `display: contents` (as `qa-unsent-center`), so a user without access gets no element and no gap.
 * - From 640 px it is a button that opens a popover panel with the latest notifications; below 640 px it is a link to
 *   `/notifications` (no cramped popover on a phone). The two swap by CSS, so only one is in the accessibility tree.
 * - A dot (never a number) says something is unread; the accessible name says how many.
 * - Every way out of the panel closes the popover first, then navigates with a same-URL reload so opening the target the
 *   page already shows still reaches it (design DD-11 part 2). Reading state and data come from the store only.
 */
@Component({
  selector: 'qa-notifications-bell',
  imports: [BrnPopoverImports, NgTemplateOutlet, RouterLink, QaButtonImports, QaSegmented, NotificationList],
  providers: [
    provideBrnPopoverConfig({ align: 'end', sideOffset: 8 }),
    // The pane carries no role of its own: the content root below is the named dialog.
    provideBrnPopoverDefaultOptions({ role: null }),
  ],
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <ng-template #bell>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        @if (unread() > 0) {
          <span data-dot aria-hidden="true" class="absolute top-[5px] right-[6px] size-[7px] rounded-full bg-(--primary) ring-2 ring-(--surface) group-hover:ring-(--surface-4) group-aria-expanded:ring-(--surface-4)"></span>
        }
      </ng-template>

      <div brnPopover #pop="brnPopover" class="contents">
        <button
          brnPopoverTrigger
          type="button"
          [attr.aria-label]="label()"
          class="group relative hidden size-8 flex-none items-center justify-center rounded-lg text-(--text-3) hover:bg-(--surface-4) focus-visible:shadow-(--focus-ring) focus-visible:outline-none aria-expanded:bg-(--surface-4) sm:flex"
        >
          <ng-container *ngTemplateOutlet="bell" />
        </button>

        <ng-template brnPopoverContent>
          <div
            #dialog
            role="dialog"
            aria-label="Notifications"
            tabindex="-1"
            class="qa-tokens box-border flex max-h-[min(560px,80dvh)] w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-(--border-raised) bg-(--surface-raised) shadow-(--shadow-pop) outline-none animate-in fade-in-0 zoom-in-95 duration-100"
          >
            <div class="flex-none border-b border-(--border-soft) px-4 pt-3.5 pb-3">
              <div class="mb-2.5 flex min-h-8 items-center justify-between gap-3">
                <h2 class="m-0 text-(length:--fs-14) font-semibold text-(--text)">Notifications</h2>
                @if (unread() > 0) {
                  <button hlmBtn qaBtn tone="link" size="sm" flush="end" type="button" (click)="markAllRead(dialog)">Mark all as read</button>
                }
              </div>
              <qa-segmented [value]="view()" (valueChange)="setView($event)" [options]="viewOptions()" aria-label="Show notifications" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <qa-notification-list
                variant="panel"
                [items]="shown()"
                [state]="store.state()"
                [emptyKind]="emptyKind()"
                (opened)="open($event, pop)"
                (retry)="store.retry()"
                (emptyAction)="view.set('all')"
              />
            </div>

            <div class="flex-none border-t border-(--border-soft) p-1.5">
              <button hlmBtn qaBtn tone="link" size="sm" type="button" class="w-full" (click)="viewAll(pop)">View all notifications</button>
            </div>
          </div>
        </ng-template>
      </div>

      <a
        routerLink="/notifications"
        [attr.aria-label]="label()"
        class="group relative flex size-10 flex-none items-center justify-center rounded-lg text-(--text-3) hover:bg-(--surface-4) focus-visible:shadow-(--focus-ring) focus-visible:outline-none sm:hidden"
      >
        <ng-container *ngTemplateOutlet="bell" />
      </a>
    }
  `,
})
export class NotificationsBell {
  protected readonly store = inject(NotificationsStore);
  private readonly access = inject(AccessControl);
  private readonly router = inject(Router);

  protected readonly visible = computed(() => this.access.canAny(Permission.ADMIN_ACCESS));
  protected readonly unread = this.store.unreadCount;
  protected readonly label = computed(() => (this.unread() > 0 ? `Notifications, ${this.unread()} unread` : 'Notifications'));

  protected readonly view = signal<'all' | 'unread'>('all');
  protected readonly viewOptions = computed<readonly QaSegmentedOption[]>(() => [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread', count: this.unread() },
  ]);

  /** Newest first, as the store gives them: the Unread switch narrows them, then the panel keeps the first few. */
  protected readonly shown = computed<readonly Notification[]>(() => {
    const items = this.view() === 'unread' ? this.store.items().filter((n) => n.unread) : this.store.items();
    return items.slice(0, PANEL_LIMIT);
  });

  /** Unread is on and nothing is unread ("Show all"); otherwise the only empty case is no notifications at all. */
  protected readonly emptyKind = computed<'unread' | 'all'>(() => (this.view() === 'unread' && this.unread() === 0 ? 'unread' : 'all'));

  constructor() {
    // The store loads once, the first time the bell is on screen (a user without access never loads it).
    effect(() => {
      if (this.visible()) untracked(() => void this.store.load());
    });
  }

  protected setView(value: string | null): void {
    this.view.set(value === 'unread' ? 'unread' : 'all');
  }

  /** The button that was pressed leaves the panel; keep focus inside it so Tab and Escape still start there. */
  protected markAllRead(dialog: HTMLElement): void {
    this.store.markAllRead();
    dialog.focus();
  }

  /** A row (or its action): read it, close the panel, then go to its target. */
  protected open(n: Notification, pop: BrnPopover): void {
    this.store.markRead(n.id);
    pop.close();
    void this.router.navigate([n.target.path], { queryParams: n.target.queryParams, onSameUrlNavigation: 'reload' });
  }

  protected viewAll(pop: BrnPopover): void {
    pop.close();
    void this.router.navigate(['/notifications'], { onSameUrlNavigation: 'reload' });
  }
}
