import { Component, input, output } from '@angular/core';
import { Palette } from './palettes';

/** Floating capsule to preview the login in each palette (design exploration only). */
@Component({
  selector: 'app-palette-switcher',
  host: { class: 'block' },
  template: `
    <div
      role="group"
      aria-label="Colour palette preview"
      class="flex items-center gap-1 rounded-full bg-white/95 p-1.5 pl-3.5 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)] ring-1 ring-black/5"
    >
      <span class="mr-1 hidden text-xs font-medium text-zinc-600 sm:inline">Palette</span>
      @for (palette of palettes(); track palette.id) {
        <button
          type="button"
          class="group flex h-8 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none aria-pressed:bg-zinc-900 aria-pressed:text-white"
          [attr.aria-pressed]="palette.id === selected()"
          [attr.title]="palette.name"
          (click)="pick.emit(palette)"
        >
          <span
            aria-hidden="true"
            class="flex size-4 overflow-hidden rounded-full ring-1 ring-black/10"
          >
            <span class="w-1/2" [style.background]="palette.bg"></span>
            <span class="w-1/2" [style.background]="palette.primary"></span>
          </span>
          <span class="sr-only sm:not-sr-only">{{ palette.name }}</span>
        </button>
      }
    </div>
  `,
})
export class PaletteSwitcher {
  readonly palettes = input.required<readonly Palette[]>();
  readonly selected = input.required<string>();
  readonly pick = output<Palette>();
}
