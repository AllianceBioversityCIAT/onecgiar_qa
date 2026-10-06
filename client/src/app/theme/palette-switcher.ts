import { Component, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { HlmInput } from '@spartan/input';
import { CUSTOM_ID, CustomColors, customColorsFrom } from './palettes';
import { BackgroundStore } from './background-store';
import { PaletteStore } from './palette-store';

interface ColorSlot {
  readonly key: keyof CustomColors;
  readonly label: string;
  readonly hint: string;
}

const SLOTS: readonly ColorSlot[] = [
  { key: 'bg', label: 'Background', hint: 'Dark base; the matte tones derive from it' },
  { key: 'light', label: 'Light panel', hint: 'Cards and light surfaces' },
  { key: 'ink', label: 'Text', hint: 'Main text on light surfaces' },
  { key: 'primary', label: 'Primary', hint: 'Used sparingly: approved, focus' },
  { key: 'accent', label: 'Accent', hint: 'Comments and small details' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Floating capsule to evaluate palettes across the platform (temporary design tool). */
@Component({
  selector: 'app-palette-switcher',
  imports: [HlmButton, HlmInput],
  host: {
    class: 'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 sm:right-5 sm:left-auto sm:translate-x-0',
  },
  template: `
    @if (editing()) {
      <form
        id="custom-palette"
        class="mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 text-zinc-800 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.55)] ring-1 ring-black/5"
        aria-labelledby="custom-palette-title"
        (submit)="apply($event)"
      >
        <h2 id="custom-palette-title" class="text-sm font-semibold">Try your own colours</h2>
        <p class="mt-0.5 text-xs text-zinc-600">
          Pick or paste a hex value; the other tones are derived.
        </p>
        <div class="mt-3 grid gap-2.5">
          @for (slot of slots; track slot.key) {
            <div class="grid grid-cols-[2.25rem_1fr_6.5rem] items-center gap-2.5">
              <input
                type="color"
                class="size-9 cursor-pointer rounded-lg border border-zinc-200 bg-white p-0.5"
                [id]="'color-' + slot.key"
                [value]="draft()[slot.key]"
                [attr.aria-label]="slot.label + ' colour picker'"
                (input)="setColor(slot.key, $any($event.target).value)"
              />
              <label [for]="'hex-' + slot.key" class="min-w-0">
                <span class="block text-xs font-medium">{{ slot.label }}</span>
                <span class="block truncate text-[0.6875rem] text-zinc-500">{{ slot.hint }}</span>
              </label>
              <input
                hlmInput
                class="h-8 font-mono text-xs uppercase"
                maxlength="7"
                spellcheck="false"
                [id]="'hex-' + slot.key"
                [value]="draft()[slot.key]"
                (input)="setColor(slot.key, $any($event.target).value)"
              />
            </div>
          }
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button hlmBtn type="button" variant="ghost" size="sm" (click)="editing.set(false)">
            Cancel
          </button>
          <button hlmBtn type="submit" size="sm" class="bg-zinc-900 text-white hover:bg-zinc-800">
            Apply
          </button>
        </div>
      </form>
    }

    <!-- Compact handle; the full row opens on hover or focus (tap on touch screens). -->
    <div
      role="group"
      aria-label="Palette and background preview"
      class="group ml-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-full bg-white/95 p-1.5 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)] ring-1 ring-black/5"
    >
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none"
        aria-label="Show palette and background options"
        title="Palette and background"
      >
        <span
          aria-hidden="true"
          class="flex size-5 overflow-hidden rounded-full ring-1 ring-black/10"
        >
          <span class="w-1/2" [style.background]="store.active().bg"></span>
          <span class="w-1/2" [style.background]="store.active().primary"></span>
        </span>
        <span
          aria-hidden="true"
          class="size-5 rounded-full bg-cover bg-center ring-1 ring-black/10"
          [style.background-image]="'url(' + backgrounds.active().src + ')'"
        ></span>
      </button>
      <div
        class="items-center gap-1 group-focus-within:flex group-hover:flex"
        [class.hidden]="!editing()"
        [class.flex]="editing()"
      >
        <span aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-zinc-200"></span>
        <span class="mr-1 hidden text-xs font-medium text-zinc-600 sm:inline">Palette</span>
        @for (palette of store.palettes(); track palette.id) {
          <button
            type="button"
            class="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none aria-pressed:bg-zinc-900 aria-pressed:text-white"
            [attr.aria-pressed]="palette.id === store.active().id"
            [attr.title]="palette.name"
            (click)="store.select(palette.id)"
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
        <button
          type="button"
          class="flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none"
          aria-controls="custom-palette"
          [attr.aria-expanded]="editing()"
          (click)="toggleEditor()"
        >
          <span aria-hidden="true">+</span>
          <span class="sr-only sm:not-sr-only">Try colours</span>
        </button>
        <span aria-hidden="true" class="mx-1.5 h-5 w-px shrink-0 bg-zinc-200"></span>
        <span class="mr-1 hidden text-xs font-medium text-zinc-600 sm:inline">Background</span>
        @for (bg of backgrounds.backgrounds; track bg.id) {
          <button
            type="button"
            class="size-8 shrink-0 rounded-full bg-cover bg-center ring-1 ring-black/10 transition-shadow hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:outline-none aria-pressed:ring-2 aria-pressed:ring-zinc-900 aria-pressed:ring-offset-2"
            [style.background-image]="'url(' + bg.src + ')'"
            [attr.aria-pressed]="bg.id === backgrounds.active().id"
            [attr.aria-label]="'Background: ' + bg.name"
            [attr.title]="bg.name"
            (click)="backgrounds.select(bg.id)"
          ></button>
        }
      </div>
    </div>
  `,
})
export class PaletteSwitcher {
  protected readonly store = inject(PaletteStore);
  protected readonly backgrounds = inject(BackgroundStore);
  protected readonly slots = SLOTS;
  protected readonly editing = signal(false);
  protected readonly draft = signal<CustomColors>(customColorsFrom(this.store.active()));

  protected toggleEditor(): void {
    if (!this.editing()) {
      const active = this.store.active();
      this.draft.set(
        this.store.custom() && active.id === CUSTOM_ID
          ? this.store.custom()!
          : customColorsFrom(active),
      );
    }
    this.editing.update((open) => !open);
  }

  protected setColor(key: keyof CustomColors, value: string): void {
    const hex = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    if (HEX.test(hex)) {
      this.draft.update((colors) => ({ ...colors, [key]: hex.toLowerCase() }));
    }
  }

  protected apply(event: Event): void {
    event.preventDefault();
    this.store.applyCustom(this.draft());
    this.editing.set(false);
  }
}
