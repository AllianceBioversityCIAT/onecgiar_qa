import { DOCUMENT, Service, computed, effect, inject, signal } from '@angular/core';
import {
  CUSTOM_ID,
  CustomColors,
  DEFAULT_PALETTE,
  PALETTES,
  Palette,
  customPalette,
  paletteStyle,
} from './palettes';

const SELECTED_KEY = 'qa.palette';
const CUSTOM_KEY = 'qa.palette.custom';

/**
 * Colour palette under evaluation, applied to the whole platform as CSS custom properties on
 * <html>. Temporary design tool: the choice lives in this browser only.
 */
@Service()
export class PaletteStore {
  private readonly root = inject(DOCUMENT).documentElement;

  private readonly selectedId = signal(DEFAULT_PALETTE.id);
  readonly custom = signal<CustomColors | null>(null);

  readonly palettes = computed<readonly Palette[]>(() => {
    const custom = this.custom();
    return custom ? [...PALETTES, customPalette(custom)] : PALETTES;
  });
  readonly active = computed(
    () => this.palettes().find((p) => p.id === this.selectedId()) ?? DEFAULT_PALETTE,
  );

  constructor() {
    effect(() => {
      for (const [name, value] of Object.entries(paletteStyle(this.active()))) {
        this.root.style.setProperty(name, value);
      }
    });
  }

  /** Called once in the browser, after hydration. */
  restore(): void {
    const custom = read<CustomColors>(CUSTOM_KEY);
    if (custom) {
      this.custom.set(custom);
    }
    const id = read<string>(SELECTED_KEY);
    if (id && this.palettes().some((p) => p.id === id)) {
      this.selectedId.set(id);
    }
  }

  select(id: string): void {
    this.selectedId.set(id);
    write(SELECTED_KEY, id);
  }

  applyCustom(colors: CustomColors): void {
    this.custom.set(colors);
    write(CUSTOM_KEY, colors);
    this.select(CUSTOM_ID);
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the palette still applies for this visit
  }
}
