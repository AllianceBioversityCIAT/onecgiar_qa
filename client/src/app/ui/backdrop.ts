import { Component, inject, signal } from '@angular/core';
import { BackgroundStore } from '../theme/background-store';

/**
 * Backdrop shared by the login and the signed-in shell: a generated image with a soft shade,
 * drifting slowly with the pointer. Glass surfaces blur what sits behind them, so this layer is
 * what gives them depth.
 */
@Component({
  selector: 'app-backdrop',
  host: {
    'aria-hidden': 'true',
    class: 'pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--qa-bg)]',
    '(window:pointermove)': 'track($event)',
  },
  template: `
    <div
      class="drift absolute -inset-8 bg-cover bg-center"
      data-testid="backdrop-image"
      [style.background-image]="'url(' + backgrounds.active().src + ')'"
      [style.translate]="shift(-16)"
    ></div>
    <!-- Shade: keeps the image from fighting the content, darker at the edges -->
    <div
      class="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_40%,transparent_30%,oklch(0.16_0.03_255/0.55))]"
    ></div>
  `,
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .drift {
        transition:
          translate 900ms cubic-bezier(0.22, 1, 0.36, 1),
          background-image 400ms ease;
      }
    }
  `,
})
export class Backdrop {
  protected readonly backgrounds = inject(BackgroundStore);

  /** Pointer offset (-0.5..0.5) for the slow parallax of the image. */
  private readonly pointer = signal({ x: 0, y: 0 });

  protected track(event: PointerEvent): void {
    this.pointer.set({
      x: event.clientX / window.innerWidth - 0.5,
      y: event.clientY / window.innerHeight - 0.5,
    });
  }

  protected shift(depth: number): string {
    const { x, y } = this.pointer();
    return `${(x * depth).toFixed(1)}px ${(y * depth).toFixed(1)}px`;
  }
}
