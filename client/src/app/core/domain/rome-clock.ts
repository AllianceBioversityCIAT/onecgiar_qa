import { DestroyRef, PLATFORM_ID, Service, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { nowInRome } from './rome-date';

/** How often the clock is read again; a step opens or closes on the minute. */
export const ROME_CLOCK_TICK_MS = 30_000;

/**
 * Current minute in Rome (`YYYY-MM-DDTHH:mm`) as a signal. A `computed` that only called
 * `nowInRome()` froze at its first run: a page left open kept saying "round 1" or offering a load
 * after the step changed. Reading `minute()` makes it run again when the minute moves.
 * On the server it stays at the render minute (no timer).
 */
@Service()
export class RomeClock {
  private readonly now = signal(nowInRome());
  readonly minute = this.now.asReadonly();

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const timer = setInterval(() => this.tick(), ROME_CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Reads the clock now (the timer calls it; tests too). Same minute = no change, nothing re-runs. */
  tick(): void {
    this.now.set(nowInRome());
  }
}
