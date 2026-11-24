import { Service, computed, signal } from '@angular/core';
import type { Notification, NotificationsLoadState } from './notifications.model';

/**
 * The one source of notifications for the bell and the page (they never import the mock): the list, the read
 * state and the load state. Read state lives in memory only, so it resets on reload (mock phase).
 * TODO(api): replace the dynamic import in `fetch()` with the notifications API; the `Notification` shape stays.
 */
@Service()
export class NotificationsStore {
  private readonly entries = signal<readonly Notification[]>([]);
  private readonly current = signal<NotificationsLoadState>('loading');

  /** True while a simulated state (mock switch) is on screen: a real load finishing must not overwrite it. */
  private simulated = false;
  private loaded = false;
  private pending: Promise<void> | null = null;

  readonly state = this.current.asReadonly();
  /** Newest first, with their live read state. */
  readonly items = this.entries.asReadonly();
  readonly unreadCount = computed(() => this.entries().filter((n) => n.unread).length);

  /** Loads the notifications once; a second call while loading shares the first, and after loading does nothing. */
  load(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.loaded) return Promise.resolve();
    const run = this.fetch().finally(() => {
      if (this.pending === run) this.pending = null;
    });
    this.pending = run;
    return run;
  }

  /** "Try again": leaves any simulated state and loads for real (the data and the read state are kept once loaded). */
  async retry(): Promise<void> {
    this.simulated = false;
    if (this.loaded) {
      this.current.set('ready');
      return;
    }
    this.current.set('loading');
    await this.load();
  }

  markRead(id: string): void {
    if (!this.entries().some((n) => n.id === id && n.unread)) return;
    this.entries.update((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)));
  }

  /** A no-op, without a signal write, when nothing is unread. */
  markAllRead(): void {
    if (!this.entries().some((n) => n.unread)) return;
    this.entries.update((list) => list.map((n) => (n.unread ? { ...n, unread: false } : n)));
  }

  /** Mock switch (`?mock=loading|error`): shows a state the mock never reaches on its own. `ready` is the same as `retry()`. */
  simulate(state: NotificationsLoadState): void {
    if (state === 'ready') {
      void this.retry();
      return;
    }
    this.simulated = true;
    this.current.set(state);
  }

  private async fetch(): Promise<void> {
    if (!this.simulated) this.current.set('loading');
    try {
      const { NOTIFICATIONS } = await import('./notifications.mock');
      this.entries.set(NOTIFICATIONS);
      this.loaded = true;
      if (!this.simulated) this.current.set('ready');
    } catch {
      if (!this.simulated) this.current.set('error');
    }
  }
}
