import { Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AccessControl } from '../../../core/access/access-control';
import { Permission } from '../../../core/access/role-definitions';
import { NotificationsStore } from './notifications-store';

/**
 * The notifications bell of the top bar, for users with `ADMIN_ACCESS` only (design DD-4, DD-10).
 * - Its host is `display: contents` (as `qa-unsent-center`), so a user without access gets no element and no gap.
 * - It is a link to `/notifications` at every width: no panel (Juanpa, 2026-10-27). It is marked current on that page.
 * - As in PRMS (Juanpa, 2026-10-28): bell, "Notifications" and the unread count in a pill. Below `md` only the bell shows,
 *   with the pill on its corner. The accessible name says how many are unread. The store is the only source.
 */
@Component({
  selector: 'qa-notifications-bell',
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <a
        routerLink="/notifications"
        routerLinkActive
        ariaCurrentWhenActive="page"
        [attr.aria-label]="label()"
        class="group relative flex size-10 flex-none items-center justify-center gap-2 rounded-lg text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) hover:bg-(--surface-4) focus-visible:shadow-(--focus-ring) focus-visible:outline-none aria-[current=page]:bg-(--surface-4) sm:size-9 md:w-auto md:px-2.5"
      >
        <svg class="flex-none text-(--text-3)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        <span aria-hidden="true" class="hidden md:inline">Notifications</span>
        @if (unread() > 0) {
          <span
            data-count
            aria-hidden="true"
            class="absolute top-0.5 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--primary) px-1 text-(length:--fs-11) leading-none font-semibold text-(--surface) tabular-nums ring-2 ring-(--surface) group-hover:ring-(--surface-4) group-aria-[current=page]:ring-(--surface-4) md:static md:ring-0"
            >{{ countText() }}</span
          >
        }
      </a>
    }
  `,
})
export class NotificationsBell {
  private readonly store = inject(NotificationsStore);
  private readonly access = inject(AccessControl);

  protected readonly visible = computed(() => this.access.canAny(Permission.ADMIN_ACCESS));
  protected readonly unread = this.store.unreadCount;
  /** The pill holds at most two digits. */
  protected readonly countText = computed(() => (this.unread() > 99 ? '99+' : String(this.unread())));
  protected readonly label = computed(() => (this.unread() > 0 ? `Notifications, ${this.unread()} unread` : 'Notifications'));

  constructor() {
    // The store loads once, the first time the bell is on screen (a user without access never loads it).
    effect(() => {
      if (this.visible()) untracked(() => void this.store.load());
    });
  }
}
