import { Component, computed, input } from '@angular/core';
import { ActiveCycleCard } from './active-cycle';

/** What the panel draws from the card's line ("Step 2 of 5 · closes 20 Nov, 23:59 CET", "All 5 steps completed"…). */
export interface CyclePanelView {
  /** "Step 2 of 5", or the whole line when it is not about a step ("Waiting for results"). */
  readonly step: string;
  /** "Closes 20 Nov, 23:59 CET": what follows the step, first letter up. Empty when there is nothing. */
  readonly detail: string;
  /** One entry per step: done, current or upcoming. Empty when the line has no step count. */
  readonly segments: readonly ('done' | 'current' | 'upcoming')[];
}

/** Reads the card line only to draw it; the line itself comes from shell/active-cycle.ts (no new data). */
export function cyclePanelView(line: string): CyclePanelView {
  const all = /^All (\d+) steps completed$/.exec(line);
  if (all) return { step: line, detail: '', segments: Array.from({ length: Number(all[1]) }, () => 'done' as const) };
  const m = /^Step (\d+) of (\d+)(?: · (.*))?$/.exec(line);
  if (!m) return { step: line, detail: '', segments: [] };
  const current = Number(m[1]);
  const total = Number(m[2]);
  const rest = m[3] ?? '';
  return {
    step: `Step ${current} of ${total}`,
    detail: rest ? rest[0].toUpperCase() + rest.slice(1) : '',
    segments: Array.from({ length: total }, (_, i) => (i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'upcoming')),
  };
}

/**
 * The active cycle at the bottom of the sidebar (Juanpa, 2026-11-25): a soft grey information panel, no border,
 * shadow or hover, so it never reads as something to click. Name and status, where the main batch is, a bar with one
 * segment per step, and when the step closes. Information only, not a link (Juanpa, 2026-10-29).
 */
@Component({
  selector: 'qa-cycle-panel',
  host: { class: 'flex flex-col gap-2.5 rounded-lg bg-(--nav-2)/60 px-3.5 py-3.5' },
  template: `
    <div class="flex items-center justify-between gap-2">
      <span class="truncate text-(length:--fs-14) font-semibold text-(--nav-fg)">{{ card().name }}</span>
      <span class="flex flex-none items-center gap-1.5 text-(length:--fs-12) font-medium text-(--nav-fg-2)">
        <span aria-hidden="true" class="size-1.5 flex-none rounded-full" [class]="card().status === 'Active' ? 'bg-(--success)' : 'bg-(--nav-fg-3)'"></span>{{ card().status }}
      </span>
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="text-(length:--fs-12) text-(--nav-fg-2)">
        <span class="font-medium">Main batch</span>@if (view().segments.length) { · {{ view().step }} }
      </span>
      @if (view().segments.length) {
        <span class="flex gap-1" aria-hidden="true">
          @for (s of view().segments; track $index) {
            <span
              class="h-1 flex-1 rounded-full"
              [class]="s === 'done' ? 'bg-(--primary)' : s === 'current' ? 'bg-(--primary)/45' : 'bg-(--border-strong)'"
            ></span>
          }
        </span>
      } @else {
        <span class="text-(length:--fs-12) text-(--nav-fg-3)">{{ view().step }}</span>
      }
    </div>
    @if (view().detail) {
      <span class="flex items-center gap-1.5 text-(length:--fs-12) tabular-nums text-(--nav-fg-3)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span class="min-w-0">{{ view().detail }}</span>
      </span>
    }
  `,
})
export class QaCyclePanel {
  readonly card = input.required<ActiveCycleCard>();
  protected readonly view = computed(() => cyclePanelView(this.card().line));
}
