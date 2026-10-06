import { Component, signal } from '@angular/core';

/**
 * Matte background of the login: tonal shapes of the active
 * palette that drift slowly with the pointer.
 */
@Component({
  selector: 'app-matte-backdrop',
  host: {
    'aria-hidden': 'true',
    class: 'pointer-events-none fixed inset-0 -z-10 overflow-hidden',
    '(window:pointermove)': 'track($event)',
  },
  template: `
    <div
      class="drift absolute -top-40 -right-56 h-[22rem] w-[64rem] -rotate-[32deg] rounded-full bg-gradient-to-b from-[var(--qa-bg-3)] to-[var(--qa-bg-2)]"
      [style.translate]="shift(-18)"
    ></div>
    <div
      class="drift absolute -right-72 bottom-24 h-[13rem] w-[48rem] -rotate-[32deg] rounded-full bg-[var(--qa-bg-2)]"
      [style.translate]="shift(-10)"
    ></div>
    <div
      class="drift absolute -bottom-24 -left-16 size-[22rem] rounded-full bg-gradient-to-br from-[var(--qa-bg-2)] to-[var(--qa-bg)]"
      [style.translate]="shift(14)"
    ></div>
    <div
      class="drift absolute top-[18%] left-[9%] size-24 rounded-full bg-[var(--qa-bg-2)]"
      [style.translate]="shift(24)"
    ></div>
    <svg
      class="drift absolute top-[12%] left-[22%] size-5 text-[var(--qa-bg-3)]"
      viewBox="0 0 20 20"
      [style.translate]="shift(30)"
    >
      <path d="M8 2h4v6h6v4h-6v6H8v-6H2V8h6z" fill="currentColor" />
    </svg>
    <svg
      class="drift absolute right-[14%] bottom-[14%] size-4 text-[var(--qa-bg-3)]"
      viewBox="0 0 20 20"
      [style.translate]="shift(-26)"
    >
      <path d="M8 2h4v6h6v4h-6v6H8v-6H2V8h6z" fill="currentColor" />
    </svg>
  `,
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .drift {
        transition: translate 900ms cubic-bezier(0.22, 1, 0.36, 1);
      }
    }
  `,
})
export class MatteBackdrop {
  /** Pointer offset (-0.5..0.5) for the slow parallax of the shapes. */
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
