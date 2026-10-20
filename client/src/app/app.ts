import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToaster } from '@spartan/sonner';
import { PaletteStore } from './theme/palette-store';

@Component({
  imports: [RouterOutlet, HlmToaster],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    // Applies the platform palette (JP) as CSS custom properties on <html>.
    inject(PaletteStore);
  }
}
