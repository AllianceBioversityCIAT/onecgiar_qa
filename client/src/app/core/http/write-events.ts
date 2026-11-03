import { Service, effect, inject, signal, untracked } from '@angular/core';

/** A write the unsent queue sent again and the server confirmed. */
export interface ReplayedWrite {
  readonly seq: number;
  readonly method: string;
  readonly url: string;
}

/** How many confirmed replays a screen can still catch up with. */
const KEEP_REPLAYS = 20;

/**
 * What a screen needs to know about writes made outside it (BUG-2, 2026-11-03), with no HTTP
 * dependency so any store can read it: the replays the unsent queue got confirmed, and how many
 * writes of the app are on their way to the server right now.
 */
@Service()
export class WriteEvents {
  /** Writes of the app in flight, replays left out (the request-safety interceptor counts them). */
  readonly inFlight = signal(0);
  /** Confirmed replays, newest last. */
  readonly replayed = signal<readonly ReplayedWrite[]>([]);
  private seq = 0;

  recordReplay(method: string, url: string): void {
    const entry: ReplayedWrite = { seq: ++this.seq, method, url };
    this.replayed.update((list) => [...list.slice(1 - KEEP_REPLAYS), entry]);
  }
}

/** Path of an API URL without the origin, the `/api/vN` prefix and the query: `/users/42/deactivate`. */
export function apiPath(url: string): string {
  return url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api\/v\d+/, '')
    .replace(/[?#].*$/, '');
}

/**
 * Reloads what a screen shows each time the unsent queue gets a write of its area confirmed
 * (`matches` gets the API path). It waits until no write of the app is in flight, so the reload
 * reads the server after the newer write too and never paints the state in between. Call it in an
 * injection context (a store constructor).
 */
export function reloadAfterReplay(matches: (path: string) => boolean, reload: () => void): void {
  const events = inject(WriteEvents);
  let seen = untracked(events.replayed).at(-1)?.seq ?? 0;
  effect(() => {
    if (events.inFlight() > 0) return;
    const fresh = events.replayed().filter((r) => r.seq > seen);
    if (fresh.length === 0) return;
    seen = fresh[fresh.length - 1].seq;
    if (fresh.some((r) => matches(apiPath(r.url)))) untracked(reload);
  });
}
