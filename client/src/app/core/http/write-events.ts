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
 * dependency so any store can read it: the replays the unsent queue got confirmed, and the writes
 * of the app on their way to the server.
 */
@Service()
export class WriteEvents {
  /** Writes of the app in flight, replays left out (the request-safety interceptor counts them). */
  readonly inFlight = signal(0);
  /** Confirmed replays, newest last. */
  readonly replayed = signal<readonly ReplayedWrite[]>([]);
  private seq = 0;
  /** Moves each time a write of the app starts or ends: a load that saw it move is stale. */
  private moves = 0;

  recordReplay(method: string, url: string): void {
    const entry: ReplayedWrite = { seq: ++this.seq, method, url };
    this.replayed.update((list) => [...list.slice(1 - KEEP_REPLAYS), entry]);
  }

  writeStarted(): void {
    this.moves++;
    this.inFlight.update((n) => n + 1);
  }

  writeEnded(): void {
    this.moves++;
    this.inFlight.update((n) => n - 1);
  }

  /** Mark to compare later: equal = no write of the app started or ended since. */
  mark(): number {
    return this.moves;
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
 * What a write changes, for keeping writes in order: the record it targets (`users/42`,
 * `timelines/7`, `cycles/3`), or a cycle's field configuration (`cycles/3/field-config`), which is
 * edited on its own. Writes of different records never wait for each other.
 */
export function resourceOf(url: string): string {
  const parts = apiPath(url).split('/').filter(Boolean);
  return (parts[2] === 'field-config' ? parts.slice(0, 3) : parts.slice(0, 2)).join('/');
}

/**
 * Reloads what a screen shows each time the unsent queue gets a write of its area confirmed
 * (`matches` gets the API path). The reload starts only when no write of the app is in flight, and
 * gets `fresh()`: false once a write started or ended after it began, so it must not paint what it
 * read (that could undo the newer write on screen). Return false in that case and it runs again
 * when the app is idle. Call it in an injection context (a store constructor).
 */
export function reloadAfterReplay(matches: (path: string) => boolean, reload: (fresh: () => boolean) => Promise<boolean>): void {
  const events = inject(WriteEvents);
  /** A matching replay the screen has not shown yet. */
  const owed = signal(false);
  let seen = untracked(events.replayed).at(-1)?.seq ?? 0;
  effect(() => {
    const fresh = events.replayed().filter((r) => r.seq > seen);
    if (fresh.length === 0) return;
    seen = fresh[fresh.length - 1].seq;
    if (fresh.some((r) => matches(apiPath(r.url)))) owed.set(true);
  });
  effect(() => {
    if (!owed() || events.inFlight() > 0) return;
    untracked(() => {
      owed.set(false);
      const mark = events.mark();
      void reload(() => events.mark() === mark).then((shown) => {
        if (!shown) owed.set(true);
      });
    });
  });
}
