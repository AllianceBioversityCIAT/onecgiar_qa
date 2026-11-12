import { Component, Renderer2, effect, inject, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide';

/**
 * Show/hide button for a password input. Place it inside a `relative` wrapper next to the input
 * (the input needs the `with-toggle` class for room) and pass the input:
 *
 * <div class="relative">
 *   <input #pw id="password" type="password" class="filled with-toggle" … />
 *   <app-password-toggle [control]="pw" />
 * </div>
 */
@Component({
  selector: 'app-password-toggle',
  imports: [NgIcon],
  providers: [provideIcons({ lucideEye, lucideEyeOff })],
  host: { class: 'absolute inset-y-0 end-1 flex items-center' },
  template: `
    <button
      type="button"
      class="grid size-9 place-items-center rounded-lg text-[var(--qa-muted-on-dark)] hover:text-[var(--qa-on-dark)] focus-visible:ring-2 focus-visible:ring-[var(--qa-primary-soft)] focus-visible:outline-none"
      [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
      [attr.aria-pressed]="visible()"
      [attr.aria-controls]="control().id || null"
      (click)="toggle()"
    >
      <ng-icon
        aria-hidden="true"
        size="1.125rem"
        [name]="visible() ? 'lucideEyeOff' : 'lucideEye'"
      />
    </button>
  `,
})
export class PasswordToggle {
  /** The password input this button reveals. */
  readonly control = input.required<HTMLInputElement>();

  protected readonly visible = signal(false);
  private readonly renderer = inject(Renderer2);

  constructor() {
    effect(() =>
      this.renderer.setAttribute(this.control(), 'type', this.visible() ? 'text' : 'password'),
    );
  }

  protected toggle(): void {
    this.visible.update((shown) => !shown);
  }
}
