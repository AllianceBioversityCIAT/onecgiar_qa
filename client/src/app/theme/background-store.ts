import { Service, computed, signal } from '@angular/core';
import { BACKGROUNDS, DEFAULT_BACKGROUND } from './backgrounds';

export const BACKGROUND_KEY = 'qa.background';

/** Backdrop image behind the glass UI; switchable while the look is being evaluated. */
@Service()
export class BackgroundStore {
  private readonly selectedId = signal(DEFAULT_BACKGROUND.id);

  readonly backgrounds = BACKGROUNDS;
  readonly active = computed(
    () => BACKGROUNDS.find((b) => b.id === this.selectedId()) ?? DEFAULT_BACKGROUND,
  );

  /** Called once in the browser, after hydration. */
  restore(): void {
    try {
      const id = localStorage.getItem(BACKGROUND_KEY);
      if (id && BACKGROUNDS.some((b) => b.id === id)) {
        this.selectedId.set(id);
      }
    } catch {
      // storage blocked: keep the default
    }
  }

  select(id: string): void {
    if (!BACKGROUNDS.some((b) => b.id === id)) {
      return;
    }
    this.selectedId.set(id);
    try {
      localStorage.setItem(BACKGROUND_KEY, id);
    } catch {
      // storage blocked: the background still applies for this visit
    }
  }
}
