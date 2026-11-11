import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CyclesApi } from '../core/api/cycles-api';
import { Cycle } from '../core/api/cycles.models';
import { TimelineNow, timelineNow, timelineVM } from '../pages/workspace/cycle/cycle.logic';
import { toViewTimeline } from '../pages/workspace/cycle/cycle.mapper';

/** What the sidebar card shows: the active cycle and where its main batch is now. */
export interface ActiveCycleCard {
  /** e.g. "2026 cycle". */
  readonly name: string;
  readonly status: string;
  /** "Step 2 of 5 · closes 20 Nov, 23:59 CET", "Waiting for results", "All 5 steps completed", "No main batch yet". */
  readonly line: string;
}

const STATUS: Record<Cycle['status'], string> = { draft: 'Draft', active: 'Active', closed: 'Closed' };
/** A quick refresh on navigation, at most this often (the card is a glance, not a live view). */
const REFRESH_MS = 60_000;

/** Short line for the narrow card, from the same summary as a collapsed batch (cycle.logic `timelineNow`). */
export function cardLine(now: TimelineNow): string {
  if (now.tone === 'active') return [now.step.split(' · ')[0], now.when].filter(Boolean).join(' · ');
  if (now.tone === 'waiting') return 'Waiting for results';
  if (now.tone === 'future') return `${now.step.split(' · ')[0]} · ${now.state}`;
  return now.step;
}

/**
 * The sidebar card of the active cycle, on the cycles API (admins only: the routes are ADMIN).
 * It used to show fixed mockup text ("Annual report 2026 · Step 4 of 5 · closes 23 Jul").
 * No card while loading, on error or without an active cycle: better nothing than a wrong date.
 */
@Injectable()
export class ActiveCycle {
  private readonly api = inject(CyclesApi);
  readonly card = signal<ActiveCycleCard | null>(null);
  private loadedAt = 0;
  private seq = 0;

  /** `force`: ignore the refresh window (first load). */
  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.loadedAt < REFRESH_MS) return;
    this.loadedAt = Date.now();
    const seq = ++this.seq;
    try {
      const cycles = await firstValueFrom(this.api.list());
      const active = cycles.find((c) => c.status === 'active');
      if (!active) {
        if (seq === this.seq) this.card.set(null);
        return;
      }
      const timelines = await firstValueFrom(this.api.timelines(active.id));
      if (seq !== this.seq) return;
      const official = timelines.find((t) => t.kind === 'official');
      const line = official ? cardLine(timelineNow(timelineVM(toViewTimeline(official, { programs: [], types: [] })))) : 'No main batch yet';
      this.card.set({ name: active.name, status: STATUS[active.status] ?? active.status, line });
    } catch {
      // Keep whatever the card showed; the Cycle page reports real problems.
      this.loadedAt = 0;
    }
  }
}
