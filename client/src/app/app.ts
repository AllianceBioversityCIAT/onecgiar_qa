import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PaletteStore } from './theme/palette-store';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    // Applies the platform palette (JP) as CSS custom properties on <html>.
    inject(PaletteStore);
  }
}
