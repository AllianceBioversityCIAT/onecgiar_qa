import { Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PaletteStore } from './theme/palette-store';
import { PaletteSwitcher } from './theme/palette-switcher';

@Component({
  imports: [RouterOutlet, PaletteSwitcher],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    const palettes = inject(PaletteStore);
    afterNextRender(() => palettes.restore());
  }
}
