import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LoadsApi } from '../../../core/api/loads-api';
import { LOAD_ERROR, LoadDetail, LoadItem, LoadStatus } from '../../../core/api/loads.models';
import { toApiError } from '../../../core/http/api-envelope';
import { Toasts } from '../../../core/http/toasts';
import { CycleStore } from './cycle-store';
import { Timeline } from './cycle.mock';
import { startErrorMessage } from './load.copy';

/** Poll rhythm the server asks for while a load runs. */
export const LOAD_POLL_MS = 2_000;
/** Polls in a row that may fail (about a minute) before the screen stops following the load. */
const MAX_POLL_FAILURES = 30;

/** The load the page header follows. */
export interface ActiveLoad {
  readonly timelineId: string;
  readonly apiId: number;
  readonly name: string;
  readonly loadId: number;
  readonly status: LoadStatus;
  readonly processed: number;
  /** `null` while the server is still counting the results. */
  readonly total: number | null;
}

/** A load that ended, with its summary (shown in the summary drawer). */
export interface FinishedLoad {
  readonly timelineName: string;
  readonly detail: LoadDetail;
}

export type LoadStartOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Loads (syncs) of the Cycle view (provided by the view, next to `CycleStore`): start one, follow it every
 * 2 s on `GET /timelines/:id/loads`, read its summary once when it ends, then refresh the timelines (their
 * steps stop waiting for results). One load runs per cycle on the server.
 */
@Injectable()
export class CycleLoads {
  private readonly api = inject(LoadsApi);
  private readonly store = inject(CycleStore);
  private readonly toasts = inject(Toasts);

  readonly active = signal<ActiveLoad | null>(null);
  readonly finished = signal<FinishedLoad | null>(null);
  /** A start is in flight: the confirm button spins and a second tap does nothing. */
  readonly starting = signal(false);
  readonly running = computed(() => this.active() !== null);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
  }

  async start(t: Timeline): Promise<LoadStartOutcome> {
    if (this.starting() || this.active() || t.apiId == null) return { ok: true };
    this.starting.set(true);
    try {
      const started = await firstValueFrom(this.api.start(t.apiId, t.name));
      this.follow(t, { id: started.id, status: 'running', processed: 0, total: null });
      return { ok: true };
    } catch (error) {
      const e = toApiError(error);
      // Another load of the cycle runs: follow it (awaited, so the caller already sees it running).
      if (e.code === LOAD_ERROR.ALREADY_RUNNING) await this.resume(this.store.timelines());
      return { ok: false, message: startErrorMessage(e) };
    } finally {
      this.starting.set(false);
    }
  }

  /** On page open (or after a refused start): follow the running load of the cycle, if any. */
  async resume(timelines: readonly Timeline[]): Promise<void> {
    if (this.active()) return;
    const withId = timelines.filter((t): t is Timeline & { apiId: number } => t.apiId != null);
    const lists = await Promise.all(
      withId.map((t) => firstValueFrom(this.api.list(t.apiId)).then((items) => ({ t, items }), () => null)),
    );
    if (this.active() || this.destroyed) return;
    for (const entry of lists) {
      const newest = entry?.items[0];
      if (entry && newest?.status === 'running') {
        this.follow(entry.t, newest);
        return;
      }
    }
  }

  closeSummary(): void {
    this.finished.set(null);
  }

  private follow(t: Timeline, item: Pick<LoadItem, 'id' | 'status' | 'processed' | 'total'>): void {
    this.failures = 0;
    this.active.set({ timelineId: t.id, apiId: t.apiId!, name: t.name, loadId: item.id, status: item.status, processed: item.processed, total: item.total });
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.destroyed) this.timer = setTimeout(() => void this.poll(), LOAD_POLL_MS);
  }

  private async poll(): Promise<void> {
    const a = this.active();
    if (!a || this.destroyed) return;
    try {
      const items = await firstValueFrom(this.api.list(a.apiId));
      if (this.destroyed || this.active()?.loadId !== a.loadId) return;
      this.failures = 0;
      const item = items.find((i) => i.id === a.loadId) ?? items[0];
      if (!item) return this.schedule();
      if (item.status === 'running') {
        this.active.set({ ...a, status: 'running', processed: item.processed, total: item.total });
        return this.schedule();
      }
      await this.end(a, item.id);
    } catch {
      if (++this.failures >= MAX_POLL_FAILURES) {
        this.active.set(null);
        this.toasts.error('We lost track of the load. It keeps running on the server: reload the page to see it.');
        return;
      }
      this.schedule();
    }
  }

  /** Read the summary once, close the counter and refresh the timelines. */
  private async end(a: ActiveLoad, loadId: number): Promise<void> {
    let detail: LoadDetail | null = null;
    try {
      detail = await firstValueFrom(this.api.get(a.apiId, loadId));
    } catch {
      this.toasts.error(`The load into ${a.name} ended, but we could not read its summary.`);
    }
    if (this.destroyed) return;
    this.active.set(null);
    if (detail) this.finished.set({ timelineName: a.name, detail });
    void this.store.load(true);
  }
}
