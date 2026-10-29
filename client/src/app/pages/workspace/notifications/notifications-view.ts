import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TIMELINES } from '../results/results.mock';
import { NotificationList } from './notification-list';
import { NotificationsStore } from './notifications-store';
import type { Notification, NotificationsLoadState } from './notifications.model';

/** The states the mock never reaches on its own, reachable with `?mock=` (design DD-9). Removed with the mock. */
const MOCK_STATES: readonly NotificationsLoadState[] = ['loading', 'error'];

const isMain = (kind: string): boolean => kind === 'Official timeline';

/**
 * Notifications for the QA Admin: batches ready for the next step, and slow science programs (what María Julia asked for).
 * One list, newest first, in day groups (Juanpa, 2026-10-29). The PRMS tabs, filters and "Mark all as read" were dropped:
 * one admin gets few notifications, each carries its button in its row and is read when she acts on it. The page only
 * reads the store (the one source the bell reads too).
 * `?mock=loading|error` shows the loading or error state while the data is a mock. The store is shared and the router
 * reuses this view when only the query changes, so the switch follows every query change and ends when the page closes.
 */
@Component({
  selector: 'qa-notifications-view',
  templateUrl: './notifications-view.html',
  imports: [NotificationList],
})
export class NotificationsView {
  protected readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** True while this page shows a `?mock=` state. */
  private simulating = false;

  /** Timeline names by id, for the rows (the list and its rows read no mock). `all` is "All timelines". */
  protected readonly timelineNames: Readonly<Record<string, string>> = Object.fromEntries([
    ['all', 'All timelines'],
    ...TIMELINES.map((t) => [t.id, t.name]),
  ]);
  /** The batch pill of each row, by timeline id. */
  protected readonly batchLabels: Readonly<Record<string, string>> = Object.fromEntries([
    ['all', 'All batches'],
    ...TIMELINES.map((t) => [t.id, isMain(t.kind) ? 'Main batch' : 'Complementary batch']),
  ]);

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const mock = params.get('mock');
      const simulated = MOCK_STATES.find((s) => s === mock);
      if (simulated) this.store.simulate(simulated);
      else if (this.simulating) void this.store.retry();
      this.simulating = !!simulated;
    });
    void this.store.load();
    inject(DestroyRef).onDestroy(() => {
      if (this.simulating) void this.store.retry();
    });
  }

  /** Reads the notification, then goes to its target; a same-URL reload so opening the same list twice still re-seeds Results. */
  protected open(n: Notification): void {
    this.store.markRead(n.id);
    void this.router.navigate([n.target.path], { queryParams: n.target.queryParams, onSameUrlNavigation: 'reload' });
  }

  /** "Not now": only reads it. */
  protected dismiss(n: Notification): void {
    this.store.markRead(n.id);
  }
}
