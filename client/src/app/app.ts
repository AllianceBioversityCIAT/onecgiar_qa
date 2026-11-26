import { DOCUMENT } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToaster } from '@spartan/sonner';
import { Toasts } from './core/http/toasts';
import { PaletteStore } from './theme/palette-store';

@Component({
  imports: [RouterOutlet, HlmToaster],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  /** A page can lift the toasts above its own bottom bar (`Toasts.bottomOffset`). */
  protected readonly toasts = inject(Toasts);

  constructor() {
    // Under 600px the toaster ignores `offset` (fixed 20px): `styles.css` reads this variable from <html> there.
    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      const phone = this.toasts.bottomOffset()?.phone ?? null;
      if (phone) root.style.setProperty('--qa-toast-bottom-phone', phone);
      else root.style.removeProperty('--qa-toast-bottom-phone');
    });
    // Applies the platform palette (JP) as CSS custom properties on <html>.
    inject(PaletteStore);
  }
}
